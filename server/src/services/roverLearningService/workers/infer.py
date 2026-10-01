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
from observations import decision_frames, history_frames

from policy import Policy, VERSION, SLOTS, VALUES, HEIGHT, WIDTH, SENSORS, select_slots, decode_command, encode_command, sensor_vector


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
    with av.open(args.url, options={'rtsp_transport': 'tcp', 'timeout': '3000000',
                                   'use_wallclock_as_timestamps': '1'}) as video:
        stream = video.streams.video[0]
        stream.codec_context.thread_count = 1
        for stamp, frame, captured_at in decision_frames(video.decode(stream)):
            if closed.is_set():
                return
            now = time.time() * 1000
            if abs(now - captured_at) > 2000:
                raise ValueError('Video time is stale or not aligned to server time')
            with mutex:
                while observations and observations[0]['ts'] < stamp:
                    event = observations.popleft()
                    if event['kind'] == 'settings':
                        args.threshold = max(.05, min(.99, float(event['threshold'])))
                    elif event['kind'] == 'sensor':
                        sensors, sensor_time = event['data'], event['ts']
                    elif event['kind'] == 'command' and event['data'].get('type') != 'drive':
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
            selected = history_frames(history, stamp)
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
            winners = select_slots(probabilities, schema, args.threshold)
            active = {slot for slot in range(len(schema)) if probabilities[slot] >= args.threshold}
            latched.intersection_update(active)
            proposals, commands = [], []
            for slot, descriptor in enumerate(schema):
                command = decode_command(descriptor, predictions[slot])
                discrete = command['type'] in ('headlight', 'raw')
                reason = ('Below threshold' if slot not in active else
                          'Competing action' if slot not in winners else
                          'Held discrete action' if discrete and slot in latched else 'Proposed')
                proposals.append({'slot': slot, 'score': probabilities[slot], 'command': command, 'reason': reason})
                if reason == 'Proposed':
                    commands.append(command)
                if slot in winners and discrete:
                    latched.add(slot)
            print(json.dumps({'kind': 'prediction', 'frameAt': captured_at, 'decisionAt': stamp, 'sensorAt': sensor_time,
                              'latencyMs': (time.perf_counter() - before) * 1000,
                              'sensorPresent': sensor_vector(sensors)[len(SENSORS):].tolist(),
                              'commands': commands, 'proposals': proposals, 'threshold': args.threshold}, allow_nan=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'kind': 'error', 'message': str(error)}), flush=True)
        raise SystemExit(1)
