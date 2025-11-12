registerModule('services/roverUI', (require, exports) => {
  const { socket } = require('globals/socket');
  const { formatHex } = require('helpers/formatters');
  const state = require('services/state');

  const statusEl = document.getElementById('status');
  const roverSelect = document.getElementById('roverSelect');
  const sensorOutput = document.getElementById('sensorOutput');
  const requestBtn = document.getElementById('requestControl');
  const lockBtn = document.getElementById('lockToggle');

  let roster = [];

  socket.on('rovers', (list) => {
    roster = list;
    roverSelect.innerHTML = '';
    list.forEach((rover) => {
      const option = document.createElement('option');
      option.value = rover.id;
      option.textContent = `${rover.name}${rover.locked ? ' (locked)' : ''}`;
      roverSelect.appendChild(option);
    });
    if (!state.getSelected() && list.length) {
      state.setSelected(list[0].id);
      roverSelect.value = list[0].id;
    }
  });

  roverSelect.addEventListener('change', () => {
    state.setSelected(roverSelect.value);
  });

  socket.on('controlGranted', ({ roverId }) => {
    state.setSelected(roverId);
    roverSelect.value = roverId;
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

  requestBtn?.addEventListener('click', () => {
    socket.emit('requestControl', { roverId: state.getSelected() });
  });

  lockBtn?.addEventListener('click', () => {
    const roverId = state.getSelected();
    const rover = roster.find((r) => r.id === roverId);
    if (!rover) return;
    socket.emit('lockRover', { roverId, locked: !rover.locked });
  });

  socket.on('connect', () => {
    statusEl.textContent = 'Connected';
  });
  socket.on('disconnect', () => {
    statusEl.textContent = 'Disconnected';
  });
});
