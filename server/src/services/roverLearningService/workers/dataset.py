"""Read closed recordings with causal state/action alignment and bounded memory."""
import bisect
import collections
import copy
import json
import math
from pathlib import Path

import av
import numpy as np
from observations import decision_frames, history_frames

from policy import SLOTS, VALUES, HEIGHT, WIDTH, SENSORS, command_family, is_stop, encode_command, sensor_vector


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


def prepare(directory, schema, stats, extend):
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
    history, targets, unsupported_times = [], [], []
    unsupported = {}
    dispatch_delays = []
    stats.update({'sensorFrames': len(sensors), 'dispatches': len(dispatches),
                  'failedCommands': len(failed), 'sensorPresentFraction': np.mean([row[1][len(SENSORS):] for row in sensors], axis=0).tolist()})
    for data in dispatches:
        command = data.get('command') or {}
        if command.get('type') in ('reset', 'reboot', 'update'):
            boundaries.append(data['ts'])
        try:
            encoded = encode_command(command, candidate, extend=extend)
        except ValueError as error:
            # Unrepresentable controls invalidate only nearby observations/targets,
            # not the rest of a recording. Never turn them into negative labels.
            request = requests.get(data.get('requestId'))
            unsupported_times.extend([data['ts'], request['ts'] if request else data['ts']])
            key = json.dumps(command, sort_keys=True)
            if key not in unsupported and len(unsupported) < 32:
                unsupported[key] = {'command': command, 'reason': str(error), 'count': 0}
            if key in unsupported:
                unsupported[key]['count'] += 1
            continue
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
            dispatch_delays.append(stamp - target_time)
            targets.append((target_time, *encoded))
        else:
            # Server safety overrides belong in history, never demonstration
            # targets. Exclude windows around them rather than teaching inaction.
            boundaries.append(stamp)
    stats['requestToDispatchMs'] = {'mean': sum(dispatch_delays) / max(1, len(dispatch_delays)),
                                    'max': max(dispatch_delays, default=0)}
    stats['acceptedCommandEvents'] = len(targets)
    stats['representedCommandEvents'] = 0
    stats['commandEventCounts'] = [0] * SLOTS
    stats['unsupportedCommands'] = list(unsupported.values())
    stats['unsupportedCommandEvents'] = len(unsupported_times) // 2
    if not targets and not unsupported_times:
        raise ValueError('No accepted client operating commands')
    schema[:] = candidate
    return metadata, sensors, sorted(history, key=lambda x: x[0]), sorted(targets, key=lambda x: x[0]), sorted(boundaries), sorted(unsupported_times)


def windows(directory, schema, cancelled=lambda: False, stats=None, extend=True):
    directory = Path(directory)
    stats = stats if stats is not None else {}
    metadata, sensors, history, targets, boundaries, unsupported_times = prepare(directory, schema, stats, extend)
    stats.update({'usableWindows': 0, 'commandWindows': 0, 'stopWindows': 0, 'noCommandWindows': 0,
                  'staleSensorWindows': 0, 'boundaryWindows': 0, 'maxSensorAgeMs': 0, 'maxFrameAgeMs': 0,
                  'unsupportedWindows': 0, 'ambiguousWindows': 0, 'videoFrames': 0, 'maxVideoGapMs': 0})
    sensor_times = [row[0] for row in sensors]
    target_times = [row[0] for row in targets]
    available = np.zeros(SLOTS, dtype=np.float32)
    available[:len(schema)] = 1
    command_values = np.zeros((SLOTS, VALUES), dtype=np.float32)
    command_times = np.full(SLOTS, -np.inf)
    cursor = 0
    recent = collections.deque(maxlen=32)
    last_pts = -math.inf
    def frames():
        nonlocal last_pts
        files = metadata['video'].get('files', ['video.mkv'])
        for name in files:
            if Path(name).name != name:
                raise ValueError('Invalid video segment path')
            with av.open(str(directory / name)) as container:
                stream = container.streams.video[0]
                stream.codec_context.thread_count = 1
                for frame in container.decode(stream):
                    if frame.pts is None:
                        raise ValueError('Video frame has no timestamp')
                    stamp = float(frame.pts * frame.time_base) * 1000
                    stats['videoFrames'] += 1
                    if math.isfinite(last_pts):
                        stats['maxVideoGapMs'] = max(stats['maxVideoGapMs'], stamp - last_pts)
                    last_pts = stamp
                    if not metadata['startedAt'] - 2000 <= stamp <= metadata['endedAt'] + 2000:
                        raise ValueError('Video PTS is not aligned to session Unix time')
                    yield frame

    represented = set()
    for stamp, frame, captured_at in decision_frames(frames()):
        if cancelled():
            return
        if stamp < metadata.get('trainingStartedAt', metadata['startedAt']):
            continue
        while cursor < len(history) and history[cursor][0] < stamp:
            when, slot, values = history[cursor]
            # Do not let drive predictions simply copy earlier human/model drive commands.
            if schema[slot]['template']['type'] != 'drive':
                command_values[slot] = values
                command_times[slot] = when
            cursor += 1
        sensor_index = bisect.bisect_left(sensor_times, stamp) - 1
        if sensor_index < 0 or stamp - sensor_times[sensor_index] > 1000:
            stats['staleSensorWindows'] += 1
            recent.clear()
            continue
        stats['maxSensorAgeMs'] = max(stats['maxSensorAgeMs'], stamp - sensor_times[sensor_index])
        stats['maxFrameAgeMs'] = max(stats['maxFrameAgeMs'], stamp - captured_at)
        seen = np.isfinite(command_times).astype(np.float32)
        ages = np.minimum((stamp - command_times) / 10000, 1).astype(np.float32)
        state = np.concatenate((sensors[sensor_index][1], command_values.flatten(), ages, seen))
        pixels = frame.to_ndarray(width=WIDTH, height=HEIGHT, format='rgb24').transpose(2, 0, 1).copy()
        recent.append((stamp, pixels, state))
        chosen = history_frames(recent, stamp)
        if len(chosen) != 4 or stamp + 100 > metadata['endedAt']:
            continue
        if bisect.bisect_right(unsupported_times, stamp + 100) > bisect.bisect_left(unsupported_times, chosen[0][0]):
            stats['unsupportedWindows'] += 1
            continue
        if bisect.bisect_right(boundaries, stamp + 100) > bisect.bisect_left(boundaries, chosen[0][0]):
            stats['boundaryWindows'] += 1
            continue
        start = bisect.bisect_left(target_times, stamp)
        end = bisect.bisect_left(target_times, stamp + 100)
        actions = np.zeros(SLOTS, dtype=np.float32)
        values = np.zeros((SLOTS, VALUES), dtype=np.float32)
        ambiguous = False
        families = set()
        for _, slot, vector in targets[start:end]:
            template = schema[slot]['template']
            family = command_family(template)
            if ((actions[slot] and (template['type'] in ('headlight', 'raw') or not np.array_equal(values[slot], vector)))
                    or (not actions[slot] and family in families)):
                ambiguous = True
                break
            families.add(family)
            actions[slot], values[slot] = 1, vector
        if ambiguous:
            stats['ambiguousWindows'] += 1
            continue
        represented.update(range(start, end))
        stats['representedCommandEvents'] = len(represented)
        for slot in np.flatnonzero(actions):
            stats['commandEventCounts'][slot] += 1
        stats['usableWindows'] += 1
        stats['commandWindows' if actions.any() else 'noCommandWindows'] += 1
        stats['stopWindows'] += int(any(actions[slot] and is_stop(descriptor) for slot, descriptor in enumerate(schema)))
        yield np.stack([row[1] for row in chosen]), np.stack([row[2] for row in chosen]), actions, values, available
