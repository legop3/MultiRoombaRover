// Latency Harness Timecode
// Purpose: Defines the in-band timestamp that makes end-to-end latency measurable without clock sync.
// Scope: Pure spec plus encode/decode helpers; no I/O, so the browser probe and the node reader share one definition.

/*
  Every generated video frame carries the wall-clock time it was produced, painted
  into the image as high-contrast squares. Whatever eventually renders that frame
  reads the squares back and subtracts from its own clock.

  This works because the whole harness runs on one machine, so producer and
  consumer read the same wall clock and there is no synchronization error to
  correct for. It also means the number measured is true glass-to-glass latency
  including encode, transport, jitter buffer, and decode, rather than a transport
  round-trip that hides everything the pipeline does at each end.

  Squares rather than rendered digits: text would need OCR, and OCR fails exactly
  when the picture degrades, which is when a latency measurement matters most. A
  block is still readable after heavy quantization, so the timecode survives the
  same bitrate starvation the video does.
*/

/*
  16px matches the h264 macroblock size, so a cell edge never falls inside a
  transform block and cannot be blurred across the threshold by quantization.
*/
const CELL_PX = 16;
// 32 bits of milliseconds since the run epoch covers ~49 days, so the counter
// cannot wrap inside a session and be misread as a negative latency.
const DATA_BITS = 32;
// Leading marker cell is always lit. It proves the strip was located correctly
// and lets the decoder reject a frame that is mid-scanout or letterboxed.
const MARKER_CELLS = 1;
const TOTAL_CELLS = MARKER_CELLS + DATA_BITS;

/*
  Cells wrap into as many rows as the frame width needs. Laying the strip out from
  the frame dimensions rather than assuming a single row means the same timecode
  works at 320x240 and at 1920x1080 without a second format to keep in sync.
*/
function layoutFor(width) {
  const cellsPerRow = Math.floor(width / CELL_PX);
  if (cellsPerRow < 1) throw new Error(`Frame width ${width} is narrower than one ${CELL_PX}px cell`);
  const rows = Math.ceil(TOTAL_CELLS / cellsPerRow);
  return { cellsPerRow, rows, stripHeightPx: rows * CELL_PX };
}

function cellOrigin(index, cellsPerRow) {
  return {
    x: (index % cellsPerRow) * CELL_PX,
    y: Math.floor(index / cellsPerRow) * CELL_PX,
  };
}

// Cells are read at their centre, so a one or two pixel scaling shift cannot
// sample a neighbouring cell.
const SAMPLE_INSET = Math.floor(CELL_PX / 2);
// Anything brighter than this counts as a one. The generator paints pure black
// and pure white, so the gap to the threshold absorbs compression ringing.
const LUMA_THRESHOLD = 128;

const ON = 255;
const OFF = 0;

function requireFrameFits(width, height) {
  const { rows, stripHeightPx } = layoutFor(width);
  if (height < stripHeightPx) {
    throw new Error(
      `Frame ${width}x${height} is too short for a ${rows}-row timecode strip (${stripHeightPx}px)`,
    );
  }
}

/*
  Paints the strip into an existing RGB24 buffer in place. The caller owns frame
  content; this only overwrites the strip region, so a real camera image can be
  stamped just as easily as a synthetic one.
*/
function paintTimecodeRgb24(buffer, width, height, value) {
  requireFrameFits(width, height);
  const { cellsPerRow } = layoutFor(width);
  const bits = value >>> 0;

  for (let cell = 0; cell < TOTAL_CELLS; cell += 1) {
    let lit;
    if (cell < MARKER_CELLS) {
      lit = true;
    } else {
      // Most significant bit first, so a truncated read fails the marker check
      // rather than silently returning a plausible small number.
      const bitIndex = DATA_BITS - 1 - (cell - MARKER_CELLS);
      lit = Boolean((bits >>> bitIndex) & 1);
    }
    const level = lit ? ON : OFF;
    const { x: startX, y: startY } = cellOrigin(cell, cellsPerRow);

    for (let row = 0; row < CELL_PX; row += 1) {
      let offset = ((startY + row) * width + startX) * 3;
      for (let column = 0; column < CELL_PX; column += 1) {
        buffer[offset] = level;
        buffer[offset + 1] = level;
        buffer[offset + 2] = level;
        offset += 3;
      }
    }
  }
  return buffer;
}

/*
  Reads the strip back out of a decoded frame. `readLuma(x, y)` lets the same
  logic serve a node RGB buffer and a browser canvas without copying either into
  a common format first.

  Returns null rather than throwing when the marker is dark, because a probe
  legitimately sees pre-roll and blank frames before the stream settles.
*/
function decodeTimecode(readLuma, width) {
  const { cellsPerRow } = layoutFor(width);

  function sample(index) {
    const { x, y } = cellOrigin(index, cellsPerRow);
    return readLuma(x + SAMPLE_INSET, y + SAMPLE_INSET);
  }

  for (let cell = 0; cell < MARKER_CELLS; cell += 1) {
    const marker = sample(cell);
    if (!(marker > LUMA_THRESHOLD)) return null;
  }

  let value = 0;
  for (let bit = 0; bit < DATA_BITS; bit += 1) {
    const luma = sample(MARKER_CELLS + bit);
    if (typeof luma !== 'number' || Number.isNaN(luma)) return null;
    value = (value << 1) | (luma > LUMA_THRESHOLD ? 1 : 0);
  }
  return value >>> 0;
}

function decodeTimecodeFromRgb24(buffer, width) {
  return decodeTimecode((x, y) => {
    const offset = (y * width + x) * 3;
    // The generator paints grey levels, so the red channel is the luma.
    return buffer[offset];
  }, width);
}

/*
  The spec the browser probe needs. Passed into the page rather than duplicated
  there, so the strip layout can never drift between generator and decoder.
*/
function timecodeSpec() {
  return {
    CELL_PX,
    DATA_BITS,
    MARKER_CELLS,
    TOTAL_CELLS,
    SAMPLE_INSET,
    LUMA_THRESHOLD,
  };
}

module.exports = {
  CELL_PX,
  DATA_BITS,
  MARKER_CELLS,
  TOTAL_CELLS,
  SAMPLE_INSET,
  LUMA_THRESHOLD,
  ON,
  OFF,
  layoutFor,
  cellOrigin,
  paintTimecodeRgb24,
  decodeTimecode,
  decodeTimecodeFromRgb24,
  timecodeSpec,
  requireFrameFits,
};
