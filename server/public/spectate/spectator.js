registerModule('spectator/main', (require, exports) => {
  const { socket } = require('globals/socket');
  const videoPlayer = require('services/videoPlayer');

  const statusEl = document.getElementById('status');
  const grid = document.getElementById('grid');
  const cards = new Map();

  socket.on('connect', () => {
    statusEl.textContent = 'Connected';
  });

  socket.on('disconnect', () => {
    statusEl.textContent = 'Disconnected';
    stopAllVideos();
  });

  socket.on('lockdown', ({ message }) => {
    statusEl.textContent = message || 'Spectator mode disabled';
    stopAllVideos();
  });

  socket.on('rovers', (list) => {
    list.forEach((rover) => {
      const card = ensureCard(rover.id);
      card.querySelector('.meta').textContent = `Locked: ${rover.locked ? 'yes' : 'no'} | Last seen: ${new Date(rover.lastSeen).toLocaleTimeString()}`;
      if (!card.dataset.videoActive) {
        connectVideo(rover.id);
      }
    });
    Array.from(cards.keys()).forEach((id) => {
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
    card.dataset.videoActive = '';
    card.innerHTML = `
      <h3>${roverId}</h3>
      <div class="meta"></div>
      <div class="video-wrap"></div>
      <div class="video-status">Video not connected</div>
      <button class="video-reconnect">Reconnect video</button>
      <pre class="sensor">Waiting for data...</pre>
    `;
    const reconnectBtn = card.querySelector('.video-reconnect');
    reconnectBtn.addEventListener('click', () => connectVideo(roverId, true));
    grid.appendChild(card);
    cards.set(roverId, card);
    connectVideo(roverId, true);
    return card;
  }

  function connectVideo(roverId, force = false) {
    const card = ensureCard(roverId);
    const status = card.querySelector('.video-status');
    const wrap = card.querySelector('.video-wrap');
    const playerId = `spectator-${roverId}`;
    if (!force && card.dataset.videoActive === 'yes') {
      return;
    }
    status.textContent = 'Connecting video…';
    socket.emit('video:request', { roverId }, (resp = {}) => {
      if (resp.error) {
        status.textContent = `Video error: ${resp.error}`;
        videoPlayer.stopStream(playerId);
        card.dataset.videoActive = '';
        return;
      }
      videoPlayer
        .startStream(playerId, {
          url: resp.url,
          token: resp.token,
          mount: wrap,
          onStatus: (state, detail) => {
            if (state === 'playing') {
              status.textContent = 'Video live';
              card.dataset.videoActive = 'yes';
            } else if (state === 'connecting') {
              status.textContent = 'Connecting video…';
            } else if (state === 'error') {
              status.textContent = `Video error: ${detail}`;
              card.dataset.videoActive = '';
            } else if (state === 'stopped') {
              status.textContent = 'Video stopped';
              card.dataset.videoActive = '';
            }
          },
        })
        .catch((err) => {
          status.textContent = `Video error: ${err.message}`;
          card.dataset.videoActive = '';
        });
    });
  }

  function removeCard(roverId) {
    const card = cards.get(roverId);
    if (card) {
      videoPlayer.stopStream(`spectator-${roverId}`);
      card.remove();
      cards.delete(roverId);
    }
  }

  function stopAllVideos() {
    Array.from(cards.keys()).forEach((id) => {
      videoPlayer.stopStream(`spectator-${id}`);
      const card = cards.get(id);
      if (card) {
        const status = card.querySelector('.video-status');
        status.textContent = 'Video stopped';
        card.dataset.videoActive = '';
      }
    });
  }
});

requireModule('spectator/main');
