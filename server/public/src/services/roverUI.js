registerModule('services/roverUI', (require, exports) => {
  const { socket } = require('globals/socket');
  const { formatHex } = require('helpers/formatters');
  const state = require('services/state');

  const statusEl = document.getElementById('status');
  const roverSelect = document.getElementById('roverSelect');
  const sensorOutput = document.getElementById('sensorOutput');
  const lockBtn = document.getElementById('lockToggle');
  const forceCheckbox = document.getElementById('forceControl');
  const adminControls = document.getElementById('adminControls');
  const modeControls = document.getElementById('modeControls');
  const modeSelect = document.getElementById('modeSelect');
  const activeDriverEl = document.getElementById('activeDriver');
  const currentRoverEl = document.getElementById('currentRover');
  const videoBtn = document.getElementById('videoRequest');
  const videoLinkEl = document.getElementById('videoLink');

  let roster = [];
  let lastSelection = null;

  state.onRoleChange((role) => {
    const isAdmin = role === 'admin' || role === 'lockdown';
    if (lockBtn) lockBtn.disabled = !isAdmin;
    if (roverSelect) roverSelect.disabled = !isAdmin;
    if (adminControls) {
      adminControls.style.display = isAdmin ? 'flex' : 'none';
    }
    if (modeControls) {
      modeControls.style.display = isAdmin ? 'block' : 'none';
      if (modeSelect) modeSelect.disabled = !isAdmin;
    }
  });

  socket.on('rovers', (list) => {
    roster = list;
    roverSelect.innerHTML = '';
    list.forEach((rover) => {
      const option = document.createElement('option');
      option.value = rover.id;
      option.textContent = `${rover.name}${rover.locked ? ' (locked)' : ''}`;
      roverSelect.appendChild(option);
    });
    const selected = state.getSelected();
    if ((!selected || !list.find((r) => r.id === selected)) && list.length) {
      state.setSelected(list[0].id);
    } else if (!list.length) {
      state.setSelected(null);
    }
    renderSelection();
  });

  roverSelect.addEventListener('change', () => {
    const roverId = roverSelect.value;
    const role = state.getRole();
    state.setSelected(roverId);
    renderSelection(true);
    if (role === 'admin' || role === 'lockdown') {
      socket.emit('requestControl', { roverId, force: !!forceCheckbox?.checked });
    }
  });

  socket.on('controlGranted', ({ roverId }) => {
    state.setSelected(roverId);
    renderSelection(true);
    statusEl.textContent = `Driving ${roverId}`;
  });

  socket.on('sensorFrame', ({ roverId, frame, sensors }) => {
    if (roverId !== state.getSelected()) return;
    const lines = [];
    if (sensors) {
      Object.entries(sensors).forEach(([key, value]) => {
        lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      });
    }
    lines.push('', 'raw:', formatHex(frame?.data));
    sensorOutput.textContent = lines.join('\n');
  });

  socket.on('activeDriver', ({ roverId, socketId }) => {
    if (roverId !== state.getSelected()) return;
    if (activeDriverEl) {
      activeDriverEl.textContent = `Active driver: ${socketId || 'none'}`;
    }
  });

  lockBtn?.addEventListener('click', () => {
    const roverId = state.getSelected();
    const rover = roster.find((r) => r.id === roverId);
    if (!rover) return;
    socket.emit('lockRover', { roverId, locked: !rover.locked });
  });

  modeSelect?.addEventListener('change', () => {
    socket.emit('setMode', { mode: modeSelect.value });
  });

  socket.on('mode', ({ mode }) => {
    if (modeSelect) {
      modeSelect.value = mode;
    }
  });

  videoBtn?.addEventListener('click', () => {
    const roverId = state.getSelected();
    if (!roverId) {
      if (videoLinkEl) videoLinkEl.textContent = 'Select a rover first';
      return;
    }
    socket.emit('video:request', { roverId }, (resp = {}) => {
      if (resp.error) {
        videoLinkEl.textContent = `Video error: ${resp.error}`;
        return;
      }
      videoLinkEl.innerHTML = `Video URL: <a href=\"${resp.url}\" target=\"_blank\">${resp.url}</a>`;
    });
  });

  socket.on('connect', () => {
    statusEl.textContent = 'Connected';
  });
  socket.on('disconnect', () => {
    statusEl.textContent = 'Disconnected';
  });

  function renderSelection(clearOutput) {
    const roverId = state.getSelected();
    if (roverSelect && roverId) {
      roverSelect.value = roverId;
    } else if (roverSelect && !roverId) {
      roverSelect.value = '';
    }
    if (currentRoverEl) {
      currentRoverEl.textContent = `Active rover: ${roverId || '--'}`;
    }
    if (sensorOutput && (clearOutput || roverId !== lastSelection)) {
      sensorOutput.textContent = roverId ? 'Waiting for sensor data...' : '';
    }
    if (clearOutput && videoLinkEl) {
      videoLinkEl.textContent = '';
    }
    lastSelection = roverId;
  }
});
