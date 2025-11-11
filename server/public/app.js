const socket = io();
const statusEl = document.getElementById('status');
const roverSelect = document.getElementById('roverSelect');
const sensorToggleBtn = document.getElementById('sensorToggle');
const motorsStopBtn = document.getElementById('motorsStop');
const sensorOutput = document.getElementById('sensorOutput');
const mediaRestartBtn = document.getElementById('mediaRestart');
let selectedRover = null;
let sensorEnabled = false;
let lastDrive = { left: 0, right: 0 };

const OI_COMMANDS = {
  start: [128],
  safe: [131],
  full: [132],
  passive: [128],
  dock: [143],
};

socket.on('connect', () => {
  statusEl.textContent = 'Connected';
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
});

socket.on('rovers', (list) => {
  roverSelect.innerHTML = '';
  list.forEach((rover) => {
    const option = document.createElement('option');
    option.value = rover.id;
    option.textContent = `${rover.name} (${rover.id})`;
    roverSelect.appendChild(option);
  });
  if (list.length && !selectedRover) {
    roverSelect.selectedIndex = 0;
    selectedRover = list[0].id;
  }
});

socket.on('sensorFrame', ({ roverId, frame }) => {
  if (roverId !== selectedRover) return;
  sensorOutput.textContent = formatSensorFrame(frame.data);
});

socket.on('commandAck', ({ roverId, status, error }) => {
  if (roverId !== selectedRover) return;
  if (status === 'ok') {
    statusEl.textContent = 'Command applied';
  } else {
    statusEl.textContent = `Command failed: ${error}`;
  }
});

roverSelect.addEventListener('change', (e) => {
  selectedRover = e.target.value;
});

sensorToggleBtn.addEventListener('click', () => {
  if (!selectedRover) return;
  sensorEnabled = !sensorEnabled;
  sensorToggleBtn.textContent = sensorEnabled ? 'Disable Sensor Stream' : 'Enable Sensor Stream';
  sendCommand('sensorStream', { enable: sensorEnabled });
});

motorsStopBtn.addEventListener('click', () => {
  sendCommand('motors', { main: 0, side: 0, vacuum: 0 });
});

mediaRestartBtn.addEventListener('click', () => {
  sendCommand('media', { action: 'restart' });
});

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (!OI_COMMANDS[mode]) return;
    sendCommand('raw', { bytes: OI_COMMANDS[mode] });
  });
});

const keys = new Set();
const driveInterval = 50;

window.addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase());
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase());
});

setInterval(() => {
  if (!selectedRover) return;
  const speeds = computeDrive();
  if (speeds.left === lastDrive.left && speeds.right === lastDrive.right) {
    return;
  }
  lastDrive = speeds;
  sendCommand('drive', speeds);
}, driveInterval);

function computeDrive() {
  const forward = keys.has('w');
  const backward = keys.has('s');
  const left = keys.has('a');
  const right = keys.has('d');
  const fast = keys.has('shift');
  const base = fast ? 300 : 150;
  let leftSpeed = 0;
  let rightSpeed = 0;

  if (forward && !backward) {
    leftSpeed += base;
    rightSpeed += base;
  } else if (backward && !forward) {
    leftSpeed -= base;
    rightSpeed -= base;
  }

  if (left && !right) {
    leftSpeed -= base;
    rightSpeed += base;
  } else if (right && !left) {
    leftSpeed += base;
    rightSpeed -= base;
  }

  if (!forward && !backward && (left || right)) {
    leftSpeed = left ? -base : base;
    rightSpeed = left ? base : -base;
  }

  return {
    left: clamp(leftSpeed, -500, 500),
    right: clamp(rightSpeed, -500, 500),
  };
}

function sendCommand(type, data = {}) {
  if (!selectedRover) return;
  socket.emit('command', { roverId: selectedRover, type, data });
}

function formatSensorFrame(base64) {
  const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
