const socket = io();

const DRIVE_SPEED = 250;
const TURN_SPEED = 200;
const STATUS_FLAGS = [
  { bit: 0x01, label: 'wifi' },
  { bit: 0x02, label: 'oi-ready' },
  { bit: 0x04, label: 'sensors' },
];

const state = {
  robots: [],
  selectedRobotId: null,
  telemetry: {},
  activeKeys: new Set(),
};

const robotSelect = document.getElementById('robotSelect');
const telemetrySummary = document.getElementById('telemetrySummary');
const sensorList = document.getElementById('sensorList');
const safeModeBtn = document.getElementById('safeModeBtn');
const fullModeBtn = document.getElementById('fullModeBtn');
const enableOiBtn = document.getElementById('enableOiBtn');
const seekDockBtn = document.getElementById('seekDockBtn');
const playSongBtn = document.getElementById('playSongBtn');
const songSlotInput = document.getElementById('songSlot');

function flattenSensors(obj, prefix = '') {
  const result = {};
  Object.entries(obj || {}).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenSensors(value, path));
    } else {
      result[path] = value;
    }
  });
  return result;
}

function renderRobots() {
  robotSelect.innerHTML = '';
  state.robots.forEach((robot) => {
    const option = document.createElement('option');
    option.value = robot.id;
    option.textContent = robot.id;
    if (robot.id === state.selectedRobotId) {
      option.selected = true;
    }
    robotSelect.appendChild(option);
  });
}

function renderTelemetry() {
  const telemetry = state.telemetry[state.selectedRobotId];
  if (!telemetry) {
    telemetrySummary.textContent = 'No telemetry';
    sensorList.textContent = '';
    return;
  }
  const { header, trailer, sensors } = telemetry;
  const flags = STATUS_FLAGS
    .filter((flag) => header.statusBits & flag.bit)
    .map((flag) => flag.label)
    .join(', ');
  const summaryLines = [
    `Seq: ${header.seq}`,
    `Uptime: ${header.uptimeMs} ms`,
    `Last Control Age: ${header.lastControlAgeMs} ms`,
    `WiFi RSSI: ${header.wifiRssiDbm} dBm`,
    `Status: ${flags || 'none'}`,
    `Applied mm/s: L ${trailer.appliedLeftMmps} | R ${trailer.appliedRightMmps}`,
    `Dropped control packets: ${trailer.droppedControlPackets}`,
  ];
  telemetrySummary.textContent = summaryLines.join('\n');

  if (sensors) {
    const flat = flattenSensors(sensors);
    sensorList.textContent = Object.entries(flat)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  } else {
    sensorList.textContent = 'Sensor block missing';
  }
}

function broadcastDrive() {
  if (!state.selectedRobotId) {
    return;
  }
  const vectors = { w: 0, a: 0, s: 0, d: 0 };
  state.activeKeys.forEach((key) => {
    if (vectors[key] !== undefined) {
      vectors[key] = 1;
    }
  });

  let left = 0;
  let right = 0;
  if (vectors.w) {
    left += DRIVE_SPEED;
    right += DRIVE_SPEED;
  }
  if (vectors.s) {
    left -= DRIVE_SPEED;
    right -= DRIVE_SPEED;
  }
  if (vectors.a) {
    left -= TURN_SPEED;
    right += TURN_SPEED;
  }
  if (vectors.d) {
    left += TURN_SPEED;
    right -= TURN_SPEED;
  }

  socket.emit('drive', {
    robotId: state.selectedRobotId,
    left,
    right,
  });
}

function handleKey(event, isDown) {
  const key = event.key.toLowerCase();
  if (!['w', 'a', 's', 'd'].includes(key)) {
    return;
  }
  event.preventDefault();
  if (isDown) {
    state.activeKeys.add(key);
  } else {
    state.activeKeys.delete(key);
  }
  broadcastDrive();
}

document.addEventListener('keydown', (event) => handleKey(event, true));
document.addEventListener('keyup', (event) => handleKey(event, false));

robotSelect.addEventListener('change', (event) => {
  state.selectedRobotId = event.target.value;
  renderTelemetry();
});

safeModeBtn.addEventListener('click', () => {
  if (!state.selectedRobotId) return;
  socket.emit('mode', { robotId: state.selectedRobotId, mode: 'SAFE' });
});

fullModeBtn.addEventListener('click', () => {
  if (!state.selectedRobotId) return;
  socket.emit('mode', { robotId: state.selectedRobotId, mode: 'FULL' });
});

enableOiBtn.addEventListener('click', () => {
  if (!state.selectedRobotId) return;
  socket.emit('enableOi', { robotId: state.selectedRobotId });
});

seekDockBtn.addEventListener('click', () => {
  if (!state.selectedRobotId) return;
  socket.emit('seekDock', { robotId: state.selectedRobotId });
});

playSongBtn.addEventListener('click', () => {
  if (!state.selectedRobotId) return;
  const slot = Number(songSlotInput.value) || 0;
  socket.emit('playSong', { robotId: state.selectedRobotId, slot });
});

socket.on('robots', (robots) => {
  state.robots = robots;
  if (!state.selectedRobotId && robots.length > 0) {
    state.selectedRobotId = robots[0].id;
  }
  renderRobots();
  renderTelemetry();
});

socket.on('telemetrySnapshot', (entries) => {
  entries.forEach(({ robotId, telemetry }) => {
    state.telemetry[robotId] = telemetry;
  });
  renderTelemetry();
});

socket.on('telemetry', ({ robotId, telemetry }) => {
  state.telemetry[robotId] = telemetry;
  if (robotId === state.selectedRobotId) {
    renderTelemetry();
  }
});
