registerModule('services/authControls', (require, exports) => {
  const { socket } = require('globals/socket');
  const state = require('services/state');

  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const roleStatus = document.getElementById('roleStatus');
  const spectatorBtn = document.getElementById('spectatorBtn');

  function updateRole(role) {
    if (roleStatus) {
      roleStatus.textContent = `Role: ${role}`;
    }
    state.setRole(role);
  }

  loginBtn?.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    socket.emit('auth:login', { username, password }, (resp = {}) => {
      if (!resp.success) {
        alert(resp.error || 'Login failed');
      } else {
        updateRole(resp.role);
      }
      passwordInput.value = '';
    });
  });

  socket.on('auth:role', ({ role }) => {
    updateRole(role);
  });
  // initialize from default role
  updateRole(state.getRole());

  spectatorBtn?.addEventListener('click', () => {
    socket.emit('role:set', { role: 'spectator' });
    updateRole('spectator');
  });
});
