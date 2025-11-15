registerModule('services/driveControls', (require, exports) => {
  const { socket } = require('globals/socket');
  const state = require('services/state');

  const motorsStopBtn = document.getElementById('motorsStop');
  const sensorToggleBtn = document.getElementById('sensorToggle');
  const modeButtons = document.querySelectorAll('[data-oi]');

  let sensorEnabled = false;
  let lastDrive = { left: 0, right: 0 };
  const keys = new Set();

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (keys.has(key)) return;
    keys.add(key);
    maybeSendDriveUpdate();
  });

  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (!keys.has(key)) return;
    keys.delete(key);
    maybeSendDriveUpdate();
  });

  function maybeSendDriveUpdate() {
    const roverId = state.getSelected();
    if (!roverId) return;
    const speeds = computeDrive();
    if (speeds.left === lastDrive.left && speeds.right === lastDrive.right) return;
    lastDrive = speeds;
    socket.emit('command', {
      roverId,
      type: 'drive',
      data: { driveDirect: speeds },
    });
  }

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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  motorsStopBtn?.addEventListener('click', () => {
    const roverId = state.getSelected();
    if (!roverId) return;
    socket.emit('command', {
      roverId,
      type: 'motors',
      data: { motorPwm: { main: 0, side: 0, vacuum: 0 } },
    });
  });

  sensorToggleBtn?.addEventListener('click', () => {
    sensorEnabled = !sensorEnabled;
    sensorToggleBtn.textContent = sensorEnabled ? 'Disable Sensor Stream' : 'Enable Sensor Stream';
    const roverId = state.getSelected();
    socket.emit('command', {
      roverId,
      type: 'sensorStream',
      data: { sensorStream: { enable: sensorEnabled } },
    });
  });

  const OI_COMMANDS = {
    start: [128],
    safe: [131],
    full: [132],
    passive: [128],
    dock: [143],
  };

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.oi;
      const bytes = OI_COMMANDS[cmd];
      if (!bytes) return;
      const roverId = state.getSelected();
      socket.emit('command', {
        roverId,
        type: 'raw',
        data: { raw: bytesToBase64(bytes) },
      });
    });
  });

  function bytesToBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }
});
