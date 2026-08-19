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
    Spread drivers across the fleet before adding another person to an existing
    rover queue. This comparison is deliberately independent of battery: a
    small battery-percentage difference should never concentrate users on one
    rover while another eligible rover has nobody assigned.
  */
  const leftDrivers = driverCount(left);
  const rightDrivers = driverCount(right);
  const leftEmpty = leftDrivers === 0;
  const rightEmpty = rightDrivers === 0;
  if (leftEmpty !== rightEmpty) return leftEmpty ? -1 : 1;

  /*
    When both choices are empty, prefer the rover that is already away from its
    dock. Docking state does not separate occupied rovers because queue balance
    is more useful there, and an existing driver may already be handling the
    rover's physical state. Unknown docking telemetry receives no undocked
    preference rather than being guessed as ready.
  */
  if (leftEmpty && rightEmpty) {
    const leftUndocked = readDockedState(left) === false;
    const rightUndocked = readDockedState(right) === false;
    if (leftUndocked !== rightUndocked) return leftUndocked ? -1 : 1;
  }

  /*
    For occupied rovers, queue length is the primary balancing signal. This is
    intentionally evaluated before battery so a one-percent battery advantage
    cannot cause every later user to pile onto the same rover.
  */
  if (leftDrivers !== rightDrivers) return leftDrivers - rightDrivers;

  const leftBattery = batteryPercentage(left);
  const rightBattery = batteryPercentage(right);
  const leftHasBattery = leftBattery != null;
  const rightHasBattery = rightBattery != null;
  if (leftHasBattery !== rightHasBattery) return leftHasBattery ? -1 : 1;
  if (leftHasBattery && leftBattery !== rightBattery) return rightBattery - leftBattery;

  /*
    Returning zero is intentional. assignmentService randomly selects from the
    complete best tier so stable Map insertion order cannot permanently favor a
    rover whose emptiness, docking state, load, and battery are all equivalent.
  */
  return 0;
}

module.exports = {
  compareRoversForAssignment,
};
