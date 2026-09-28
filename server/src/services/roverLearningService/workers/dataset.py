"""Read closed recordings with causal state/action alignment and bounded memory."""
import bisect
import collections
import copy
import json
import math
from pathlib import Path

import av
import numpy as np

from policy import SLOTS, VALUES, HEIGHT, WIDTH, encode_command, sensor_vector


def load_events(directory):
    metadata = json.loads((directory / 'session.json').read_text())
    if (metadata.get('version') != 1 or not metadata.get('endedAt') or metadata.get('error')
            or metadata.get('droppedEvents') or metadata.get('reason') == 'interrupted'):
        raise ValueError('Incomplete/interrupted recording or lost events')
    if metadata.get('video', {}).get('origin') != 'unix':
        raise ValueError('Unsupported video time origin')
    video_result = metadata.get('video', {}).get('result') or {}
    if video_result.get('signal') == 'SIGKILL' or video_result.get('code') not in (0, 255, None):
        raise ValueError('Video recorder failed or was forcibly killed')
    event_file = directory / 'events.ndjson'
    if event_file.stat().st_size > 64 * 1024 * 1024:
        raise ValueError('Event file exceeds 64 MiB read bound')
    events = []
    with event_file.open() as stream:
        for line in stream:
            event = json.loads(line)
            if event['kind'] == 'captureGap':
                raise ValueError('Recording contains a capture gap')
            if not isinstance(event.get('ts'), (int, float)) or not math.isfinite(event['ts']):
                raise ValueError('Invalid event timestamp')
            events.append(event)
    if not events or not any(e['kind'] == 'sessionEnd' for e in events):
        raise ValueError('Missing completed event stream')
    # File order can differ across rotation buffering. Monotonic time detects
    # wall-clock steps; sorting Unix timestamps alone would hide those steps.
    timed = sorted(events, key=lambda e: int(e['monotonicNs']))
    origin = timed[0]
    for event in timed:
        drift = (event['ts'] - origin['ts']) - (int(event['monotonicNs']) - int(origin['monotonicNs'])) / 1e6
        if abs(drift) > 250:
            raise ValueError('Server wall clock shifted during recording')
    return metadata, sorted(events, key=lambda e: e['ts'])


def prepare(directory, schema):
    metadata, events = load_events(directory)
    requests = {}
    accepted = set()
    failed = set()
    sensors, dispatches, boundaries = [], [], []
    for event in events:
        data = event['data']
        if event['kind'] == 'sensor':
            sensors.append((event['ts'], sensor_vector(data.get('sensors') or {})))
        if event['kind'] in ('driver', 'turn:activeDriver', 'lock', 'private'):
            boundaries.append(event['ts'])
        if event['kind'] != 'command':
            continue
        if data.get('phase') == 'requested' and data.get('source') == 'client':
            requests[data.get('requestId')] = data
        if data.get('phase') == 'result' and data.get('result', {}).get('id'):
            accepted.add(data['result']['id'])
        if data.get('phase') == 'acknowledged' and data.get('acknowledgement', {}).get('error'):
            failed.add(data.get('commandId'))
        if data.get('phase') == 'dispatched':
            dispatches.append(data)
    if not sensors:
        raise ValueError('No sensor observations')
    candidate = copy.deepcopy(schema)
    history, targets = [], []
    for data in dispatches:
        encoded = encode_command(data.get('command') or {}, candidate, extend=True)
        if encoded is None:
            continue
        stamp = data['ts']
        history.append((stamp, *encoded))
        request = requests.get(data.get('requestId'))
        if (data.get('source') == 'client' and request
                and data.get('commandId') in accepted and data.get('commandId') not in failed):
            target_time = request['ts']
            if not 0 <= stamp - target_time <= 1000:
                raise ValueError('Invalid request/dispatch timing')
            targets.append((target_time, *encoded))
        else:
            # Server safety overrides belong in history, never demonstration
            # targets. Exclude windows around them rather than teaching inaction.
            boundaries.append(stamp)
    if not targets:
        raise ValueError('No accepted client operating commands')
    schema[:] = candidate
    return metadata, sensors, sorted(history, key=lambda x: x[0]), sorted(targets, key=lambda x: x[0]), sorted(boundaries)


def windows(directory, schema, cancelled=lambda: False):
    directory = Path(directory)
    metadata, sensors, history, targets, boundaries = prepare(directory, schema)
    sensor_times = [row[0] for row in sensors]
    target_times = [row[0] for row in targets]
    available = np.zeros(SLOTS, dtype=np.float32)
    for _, slot, _ in history:
        available[slot] = 1
    command_values = np.zeros((SLOTS, VALUES), dtype=np.float32)
    command_times = np.full(SLOTS, -np.inf)
    cursor = 0
    recent = collections.deque(maxlen=32)
    last_sample, last_pts = -math.inf, -math.inf
    with av.open(str(directory / 'video.mkv')) as container:
        stream = container.streams.video[0]
        stream.codec_context.thread_count = 1
        for frame in container.decode(stream):
            if cancelled():
                return
            if frame.pts is None:
                raise ValueError('Video frame has no timestamp')
            stamp = float(frame.pts * frame.time_base) * 1000
            if not math.isfinite(stamp) or stamp < last_pts:
                raise ValueError('Invalid/nonmonotonic video timestamps')
            last_pts = stamp
            if not metadata['startedAt'] - 2000 <= stamp <= metadata['endedAt'] + 2000:
                raise ValueError('Video PTS is not aligned to session Unix time')
            if stamp - last_sample < 99:
                continue
            last_sample = stamp
            while cursor < len(history) and history[cursor][0] < stamp:
                when, slot, values = history[cursor]
                command_values[slot] = values
                command_times[slot] = when
                cursor += 1
            sensor_index = bisect.bisect_right(sensor_times, stamp) - 1
            if sensor_index < 0 or stamp - sensor_times[sensor_index] > 1000:
                recent.clear()
                continue
            seen = np.isfinite(command_times).astype(np.float32)
            ages = np.minimum((stamp - command_times) / 10000, 1).astype(np.float32)
            state = np.concatenate((sensors[sensor_index][1], command_values.flatten(), ages, seen))
            pixels = frame.to_ndarray(width=WIDTH, height=HEIGHT, format='rgb24').transpose(2, 0, 1).copy()
            recent.append((stamp, pixels, state))
            chosen = []
            for offset in (900, 600, 300, 0):
                options = [row for row in recent if row[0] <= stamp - offset + 0.01]
                if not options or stamp - offset - options[-1][0] > 200:
                    break
                chosen.append(options[-1])
            if len(chosen) != 4 or stamp + 100 > metadata['endedAt']:
                continue
            if bisect.bisect_right(boundaries, stamp + 100) > bisect.bisect_left(boundaries, chosen[0][0]):
                continue
            start = bisect.bisect_left(target_times, stamp)
            end = bisect.bisect_left(target_times, stamp + 100)
            actions = np.zeros(SLOTS, dtype=np.float32)
            values = np.zeros((SLOTS, VALUES), dtype=np.float32)
            ambiguous = False
            families = set()
            for _, slot, vector in targets[start:end]:
                template = schema[slot]['template']
                family = template['type']
                if family == 'peripheral':
                    peripheral = template.get('peripheral') or {}
                    family += ':' + str(peripheral.get('id')) + ':' + str(peripheral.get('control'))
                if ((actions[slot] and (not schema[slot]['fields'] or not np.array_equal(values[slot], vector)))
                        or (not actions[slot] and family in families)):
                    ambiguous = True
                    break
                families.add(family)
                actions[slot], values[slot] = 1, vector
            if ambiguous:
                continue
            yield np.stack([row[1] for row in chosen]), np.stack([row[2] for row in chosen]), actions, values, available
