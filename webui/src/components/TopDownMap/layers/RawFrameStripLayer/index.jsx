import React, { useMemo } from 'react';
import { useVisualTelemetrySelector } from '../../../../context/TelemetryContext.jsx';
import { RawFrameStrip } from '../../visuals.jsx';

const EMPTY_RAW_FRAME_BYTES = Object.freeze([]);

function selectRawSensorFrame(frame) {
  return frame?.raw || null;
}

function decodeRawFrameBytes(rawFrame) {
  if (!rawFrame || typeof rawFrame !== 'string' || typeof globalThis.atob !== 'function') {
    return EMPTY_RAW_FRAME_BYTES;
  }

  try {
    const binary = globalThis.atob(rawFrame);
    const bytes = [];
    for (let idx = 0; idx < binary.length; idx += 1) {
      // atob returns a binary string where each character code is the original
      // byte value. Masking with 0xff keeps the visualization tied to the raw
      // byte stream even if a browser exposes a wider internal string code unit.
      bytes.push(binary.charCodeAt(idx) & 0xff);
    }
    return bytes;
  } catch {
    return EMPTY_RAW_FRAME_BYTES;
  }
}

function RawFrameStripLayer({ roverId, geometry }) {
  const rawFrame = useVisualTelemetrySelector(roverId, selectRawSensorFrame, Object.is);
  const bytes = useMemo(() => decodeRawFrameBytes(rawFrame), [rawFrame]);

  return (
    <RawFrameStrip
      x={geometry.rawFrameStrip.x}
      y={geometry.rawFrameStrip.y}
      width={geometry.rawFrameStrip.width}
      height={geometry.rawFrameStrip.height}
      bytes={bytes}
    />
  );
}

export default React.memo(RawFrameStripLayer);
