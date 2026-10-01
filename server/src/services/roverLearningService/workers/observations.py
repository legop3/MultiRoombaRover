"""Shared causal 10 Hz sampling for recorded and live video."""
import math


def decision_frames(frames):
    """Yield decision time, latest past image, and its actual capture timestamp.

    Sampling every third/fourth decoded frame leaves holes at rates such as 25
    FPS. A fixed grid covers each 100ms command interval exactly once. A frame
    after the decision can release the pending tick, but is never its input.
    """
    previous = None
    previous_time = None
    tick = None
    for frame in frames:
        if frame.pts is None:
            raise ValueError('Video frame has no timestamp')
        stamp = float(frame.pts * frame.time_base) * 1000
        if not math.isfinite(stamp) or (previous_time is not None and stamp < previous_time):
            raise ValueError('Invalid/nonmonotonic video timestamps')
        if tick is None:
            tick = stamp
        while tick < stamp - .01:
            # Do not synthesize observations over missing/stalled video. History
            # selection will reject a temporal gap until fresh history exists.
            if previous is not None and tick - previous_time <= 200:
                yield tick, previous, previous_time
            elif stamp - tick > 200:
                tick += max(1, math.floor((stamp - tick) / 100)) * 100
                continue
            tick += 100
        if abs(stamp - tick) <= .01:
            yield tick, frame, stamp
            tick += 100
        previous, previous_time = frame, stamp


def history_frames(history, stamp):
    selected = []
    for offset in (900, 600, 300, 0):
        candidates = [row for row in history if row[0] <= stamp - offset + .01]
        if not candidates or stamp - offset - candidates[-1][0] > 200:
            return []
        selected.append(candidates[-1])
    return selected
