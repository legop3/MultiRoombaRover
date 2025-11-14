registerModule('spectator/main', (require, exports) => {
  const { socket } = require('globals/socket');

  const statusEl = document.getElementById('status');
  const grid = document.getElementById('grid');
  const cards = new Map();

  socket.on('connect', () => {
    statusEl.textContent = 'Connected';
  });

  socket.on('disconnect', () => {
    statusEl.textContent = 'Disconnected';
  });

  socket.on('lockdown', ({ message }) => {
    statusEl.textContent = message || 'Spectator mode disabled';
  });

  socket.on('rovers', (list) => {
    const seen = new Set();
    list.forEach((rover) => {
      const card = ensureCard(rover.id);
      card.querySelector('.meta').textContent = `Locked: ${rover.locked ? 'yes' : 'no'} | Last seen: ${new Date(rover.lastSeen).toLocaleTimeString()}`;
    });
    cards.forEach((_, id) => {
      if (!list.find((r) => r.id === id)) {
        removeCard(id);
      }
    });
  });

  socket.on('sensorFrame', ({ roverId, sensors }) => {
    const card = ensureCard(roverId);
    card.querySelector('.sensor').textContent = sensors ? JSON.stringify(sensors, null, 2) : 'No data';
  });

  function ensureCard(roverId) {
    if (cards.has(roverId)) {
      return cards.get(roverId);
    }
    const card = document.createElement('div');
    card.className = 'rover-card';
    card.innerHTML = `
      <h3>${roverId}</h3>
      <div class="meta"></div>
      <pre class="sensor">Waiting for data...</pre>
    `;
    grid.appendChild(card);
    cards.set(roverId, card);
    return card;
  }

  function removeCard(roverId) {
    const card = cards.get(roverId);
    if (card) {
      card.remove();
      cards.delete(roverId);
    }
  }
});

requireModule('spectator/main');
