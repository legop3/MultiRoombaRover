// Rover assignment ranking
// Purpose: Ranks otherwise eligible rovers using the fleet's assignment priorities.
// Scope: Contains only deterministic comparison logic; access checks and the final random tie-break remain in assignmentService.

function readDockedState(rover) {
  /*
    The rover record normally exposes the server's canonical docked state. The
    sensor fallback covers the short interval where telemetry has arrived but
    the derived top-level field has not yet been synchronized. Unknown docking
    state deliberately remains unknown instead of being treated as undocked.
  */
  if (rover?.docked === true || rover?.docked === false) return rover.docked;
  const sensors = rover?.lastSensor?.decoded || rover?.lastSensor?.sensors || null;
  const homeBase = sensors?.chargingSources?.homeBase;
  return homeBase === true || homeBase === false ? homeBase : null;
}

function driverCount(rover) {
  /*
    Production rover records use a Set. Returning a safe high-level count here
    keeps ranking predictable for partially initialized records and makes the
    comparator straightforward to exercise with small test fixtures.
  */
  return Number.isFinite(rover?.drivers?.size) ? rover.drivers.size : 0;
}

function batteryPercentage(rover) {
  /*
    percentDisplay is the canonical server-normalized percentage used by the
    rest of the application. Missing or invalid telemetry receives no invented
    percentage; the comparator places unknown batteries after every known one.
  */
  const percentage = rover?.batteryState?.percentDisplay;
  return Number.isFinite(percentage) ? percentage : null;
}

function compareRoversForAssignment(left, right) {
  /*
    An undocked rover with nobody assigned is the most useful placement because
    it starts a fresh driving session without adding another user to a queue.
    Both conditions must be true to receive this first-priority rank.
  */
  const leftReadyAndEmpty = readDockedState(left) === false && driverCount(left) === 0;
  const rightReadyAndEmpty = readDockedState(right) === false && driverCount(right) === 0;
  if (leftReadyAndEmpty !== rightReadyAndEmpty) return leftReadyAndEmpty ? -1 : 1;

  const leftBattery = batteryPercentage(left);
  const rightBattery = batteryPercentage(right);
  const leftHasBattery = leftBattery != null;
  const rightHasBattery = rightBattery != null;
  if (leftHasBattery !== rightHasBattery) return leftHasBattery ? -1 : 1;
  if (leftHasBattery && leftBattery !== rightBattery) return rightBattery - leftBattery;

  /*
    Battery-equivalent rovers are balanced by current assignment load. Returning
    zero after this comparison is intentional: assignmentService randomly picks
    within that exact best tier so stable Map insertion order does not create a
    permanent favorite rover.
  */
  return driverCount(left) - driverCount(right);
}

module.exports = {
  compareRoversForAssignment,
};
