// Bottom Sensor HUD Geometry
// Purpose: Defines one physical front-rover curve shared by bumpers, IR sensors, and cliffs.
// Scope: Contains static display geometry only; telemetry components decide which shapes are visible.

export const SENSOR_HUD_VIEW_BOX = '0 0 1000 140';
export const LEFT_BUMPER_PATH = 'M 8 128 Q 248 60 488 60';
export const RIGHT_BUMPER_PATH = 'M 512 60 Q 752 60 992 128';

/* Horizontal center tangents keep the mirrored halves circular instead of forming a pointed crown. */
const LEFT_CURVE = Object.freeze({ x0: 8, x1: 488, y0: 128, controlY: 60, y1: 60 });
const RIGHT_CURVE = Object.freeze({ x0: 512, x1: 992, y0: 60, controlY: 60, y1: 128 });

function curveForX(x) {
  return x < 500 ? LEFT_CURVE : RIGHT_CURVE;
}

export function bumperCurvePoint(x) {
  const curve = curveForX(x);
  const t = Math.max(0, Math.min(1, (x - curve.x0) / (curve.x1 - curve.x0)));
  const oneMinusT = 1 - t;
  const y =
    oneMinusT * oneMinusT * curve.y0 +
    2 * oneMinusT * t * curve.controlY +
    t * t * curve.y1;
  const dyDt =
    2 * oneMinusT * (curve.controlY - curve.y0) +
    2 * t * (curve.y1 - curve.controlY);
  const slope = dyDt / (curve.x1 - curve.x0);
  return { x, y, slope };
}

function segmentPath(startX, endX, verticalOffset) {
  const start = bumperCurvePoint(startX);
  const end = bumperCurvePoint(endX);
  const middle = bumperCurvePoint((startX + endX) / 2);
  /* Solve the quadratic control height so the segment passes through the shared curve midpoint. */
  const controlY = 2 * (middle.y + verticalOffset) - (start.y + end.y) / 2 - verticalOffset;
  return `M ${startX} ${start.y + verticalOffset} Q ${(startX + endX) / 2} ${controlY} ${endX} ${end.y + verticalOffset}`;
}

const IR_SENSOR_X = [75, 225, 400, 600, 775, 925];
const IR_SENSOR_WIDTHS = [78, 70, 64, 64, 70, 78];
const IR_OFFSET_ABOVE_BUMPER = 10;

export const IR_SENSOR_GEOMETRY = IR_SENSOR_X.map((x, index) => {
  const point = bumperCurvePoint(x);
  /* The upward normal makes outer sensors fan sideways and center sensors project upward. */
  const normalLength = Math.hypot(point.slope, 1);
  return Object.freeze({
    key: ['left', 'front-left', 'center-left', 'center-right', 'front-right', 'right'][index],
    tipX: x,
    tipY: point.y - IR_OFFSET_ABOVE_BUMPER,
    directionX: point.slope / normalLength,
    directionY: -1 / normalLength,
    width: IR_SENSOR_WIDTHS[index],
  });
});

const CLIFF_OFFSET_BELOW_BUMPER = 21;
const CLIFF_RANGES = [
  ['left', 185, 315],
  ['frontLeft', 345, 485],
  ['frontRight', 515, 655],
  ['right', 685, 815],
];

export const CLIFF_ARCS = CLIFF_RANGES.map(([key, startX, endX]) => Object.freeze({
  key,
  path: segmentPath(startX, endX, CLIFF_OFFSET_BELOW_BUMPER),
}));
