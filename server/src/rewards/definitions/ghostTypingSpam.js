// Reward Definition: Ghost Typing Spam
// Purpose: Defines the ghost-typing spam reward used for chat-based deterrence events. Scope: Exposes reward metadata and handler inputs for moderation/reward pipelines.
const NAMES = ['ross', 'david', 'chirpet', 'caydu', 'meow', 'wawa'];
const BURSTS = 120;
const MIN_BURST_DELAY_MS = 70;
const MAX_BURST_DELAY_MS = 350;

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  id: 'ghostTypingSpam',
  name: 'Typing Spam',
  description: 'Fills chat with fake typing indicators.',
  goal: 220,
  async run(ctx) {
    const active = new Set();
    for (let burst = 0; burst < BURSTS; burst += 1) {
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
      await sleep(randInt(MIN_BURST_DELAY_MS, MAX_BURST_DELAY_MS));
    }

    active.forEach((ghost) => {
      try {
        ctx.sendExternalTyping({ nickname: ghost, role: 'spectator', roverId: null, isTyping: false });
      } catch {
        // ignore
      }
    });

    ctx.sendAlert({ color: '#9c27b0', title: 'Typing Spam', message: 'Ghost typing burst started.' });
  },
};
