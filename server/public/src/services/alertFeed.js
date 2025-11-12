registerModule('services/alertFeed', (require, exports) => {
  const { socket } = require('globals/socket');

  const container = document.getElementById('alerts');
  if (!container) return;

  function pushAlert({ color = '#2196f3', title, message, ts }) {
    const div = document.createElement('div');
    div.className = 'alert';
    div.style.borderColor = color;
    div.style.background = color + '22';
    div.innerHTML = `<strong>${title || 'Notice'}</strong> - ${message || ''}`;
    container.prepend(div);
    while (container.children.length > 5) {
      container.removeChild(container.lastChild);
    }
    setTimeout(() => {
      if (div.parentElement === container) {
        container.removeChild(div);
      }
    }, 15000);
  }

  socket.on('alert', pushAlert);
});
