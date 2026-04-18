const NAMES = ['ross', 'david', 'chirpet', 'caydu', 'meow', 'wawa'];
const BURSTS = 200;
const TICK_MS = 180;

module.exports = {
  id: 'ghostTypingSpam',
  name: 'Typing Spam',
  goal: 220,
  async run(ctx) {
    let tick = 0;
    const active = new Set();
    const timer = setInterval(() => {
      tick += 1;
      const name = NAMES[Math.floor(Math.random() * NAMES.length)] + String(Math.floor(Math.random() * 10));
      const on = Math.random() > 0.35;
      try {
        ctx.sendExternalTyping({
          nickname: name,
          role: 'spectator',
          roverId: null,
          isTyping: on,
        });
        if (on) active.add(name);
      } catch {
        // ignore
      }
      if (tick >= BURSTS) {
        clearInterval(timer);
        active.forEach((ghost) => {
          try {
            ctx.sendExternalTyping({ nickname: ghost, role: 'spectator', roverId: null, isTyping: false });
          } catch {
            // ignore
          }
        });
      }
    }, TICK_MS);

    ctx.sendAlert({ color: '#9c27b0', title: 'Typing Spam', message: 'Ghost typing burst started.' });
  },
};
