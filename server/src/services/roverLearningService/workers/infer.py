#!/usr/bin/env python3
"""Live policy worker. JSON state on stdin, proposals on stdout; no rover writes."""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path
import sys
import threading
import time

import av
import numpy as np
import torch

from policy import Policy, VERSION, SLOTS, VALUES, HEIGHT, WIDTH, encode_command, sensor_vector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--url', required=True)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--threshold', type=float, default=0.7)
    args = parser.parse_args()
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    directory = Path(args.model)
    metadata = json.loads((directory / 'model.json').read_text())
    if metadata['specification']['version'] != VERSION:
        raise ValueError('Model specification is incompatible')
    if hashlib.sha256((directory / 'weights.pt').read_bytes()).hexdigest() != metadata['sha256']:
        raise ValueError('Model weights checksum mismatch')
    schema = metadata['specification']['commands']
    model = Policy().eval()
    model.load_state_dict(torch.load(directory / 'weights.pt', map_location='cpu', weights_only=True))
    observations = collections.deque(maxlen=2048)
    mutex = threading.Lock()
    closed = threading.Event()

    def read_input():
        try:
            for line in sys.stdin:
                event = json.loads(line)
                with mutex:
                    observations.append(event)
        finally:
            closed.set()

    threading.Thread(target=read_input, daemon=True).start()
    values = np.zeros((SLOTS, VALUES), dtype=np.float32)
    last_commands = np.full(SLOTS, -np.inf)
    sensors, sensor_time = {}, 0
    history = collections.deque(maxlen=32)
    latched = set()
    sampled = 0
    with av.open(args.url, options={'rtsp_transport': 'tcp', 'timeout': '3000000',
                                   'use_wallclock_as_timestamps': '1'}) as video:
        stream = video.streams.video[0]
        stream.codec_context.thread_count = 1
        for frame in video.decode(stream):
            if closed.is_set():
                return
            if frame.pts is None:
                continue
            stamp = float(frame.pts * frame.time_base) * 1000
            now = time.time() * 1000
            if not math.isfinite(stamp) or abs(now - stamp) > 2000:
                raise ValueError('Video time is stale or not aligned to server time')
            if stamp - sampled < 99:
                continue
            sampled = stamp
            with mutex:
                while observations and observations[0]['ts'] < stamp:
                    event = observations.popleft()
                    if event['kind'] == 'sensor':
                        sensors, sensor_time = event['data'], event['ts']
                    elif event['kind'] == 'command':
                        try:
                            encoded = encode_command(event['data'], schema)
                            if encoded:
                                slot, vector = encoded
                                values[slot], last_commands[slot] = vector, event['ts']
                        except ValueError:
                            pass  # Unseen manual controls do not stop autonomy.
            if stamp - sensor_time > 1000:
                history.clear()
                continue
            state = np.concatenate((sensor_vector(sensors), values.flatten(),
                                    np.minimum((stamp - last_commands) / 10000, 1).astype(np.float32),
                                    np.isfinite(last_commands).astype(np.float32)))
            pixels = frame.to_ndarray(width=WIDTH, height=HEIGHT, format='rgb24').transpose(2, 0, 1).copy()
            history.append((stamp, pixels, state))
            selected = []
            for offset in (900, 600, 300, 0):
                candidates = [entry for entry in history if entry[0] <= stamp - offset + .01]
                if not candidates or stamp - offset - candidates[-1][0] > 200:
                    break
                selected.append(candidates[-1])
            if len(selected) != 4:
                continue
            before = time.perf_counter()
            with torch.inference_mode():
                logits, numeric = model(torch.from_numpy(np.stack([row[1] for row in selected])).unsqueeze(0).float() / 255,
                                        torch.from_numpy(np.stack([row[2] for row in selected])).unsqueeze(0))
                probabilities = logits[0].sigmoid().tolist()
                predictions = numeric[0].tolist()
            if not all(math.isfinite(value) for value in probabilities):
                raise ValueError('Nonfinite model output')
            families = {}
            active = set()
            for slot, descriptor in enumerate(schema):
                if probabilities[slot] < args.threshold:
                    continue
                active.add(slot)
                command = json.loads(json.dumps(descriptor['template']))
                family = command['type']
                if family == 'peripheral':
                    family += ':' + str(command['peripheral']['id']) + ':' + str(command['peripheral']['control'])
                for index, field in enumerate(descriptor['fields']):
                    number = predictions[slot][index]
                    if not math.isfinite(number):
                        raise ValueError('Nonfinite control value')
                    number = math.tan(max(-.98, min(.98, number)) * math.pi / 2) * field['scale']
                    target = command
                    for key in field['path'][:-1]:
                        target = target[key]
                    target[field['path'][-1]] = round(number) if field['integer'] else number
                discrete = command['type'] in ('headlight', 'laser', 'horn', 'song', 'raw')
                if family not in families or probabilities[slot] > families[family][0]:
                    families[family] = (probabilities[slot], command, slot, discrete)
            latched.intersection_update(active)
            # Choose the winning action before latching, so a held toggle cannot
            # expose a competing lower-confidence toggle on the following tick.
            commands = [command for _, command, slot, discrete in families.values()
                        if not discrete or slot not in latched]
            for _, _, slot, discrete in families.values():
                if discrete:
                    latched.add(slot)
            print(json.dumps({'kind': 'prediction', 'frameAt': stamp, 'sensorAt': sensor_time,
                              'latencyMs': (time.perf_counter() - before) * 1000,
                              'commands': commands}, allow_nan=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'kind': 'error', 'message': str(error)}), flush=True)
        raise SystemExit(1)
