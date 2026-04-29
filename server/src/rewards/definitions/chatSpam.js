// Reward Definition: Chat Spam
// Purpose: Defines the chat-spam reward for automated disruptive message bursts. Scope: Exposes metadata and effect settings consumed by reward execution.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const BURST_COUNT = 18;
const MIN_BURST_SIZE = 2;
const MAX_BURST_SIZE = 8;
const MIN_BURST_DELAY_MS = 80;
const MAX_BURST_DELAY_MS = 420;

function randLetter() {
  return LETTERS[Math.floor(Math.random() * LETTERS.length)];
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  id: 'chatSpam',
  name: 'Chat Spam',
  goal: 320,
  async run(ctx) {
    const nickname = randLetter();
    for (let burst = 0; burst < BURST_COUNT; burst += 1) {
      const burstSize = randInt(MIN_BURST_SIZE, MAX_BURST_SIZE);
      for (let i = 0; i < burstSize; i += 1) {
        const len = 3 + Math.floor(Math.random() * 14);
        let text = '';
        for (let j = 0; j < len; j += 1) {
          text += randLetter();
        }
        try {
          ctx.sendExternalMessage({
            nickname,
            role: 'spectator',
            roverId: null,
            text,
          });
        } catch {
          // ignore spam errors
        }
      }
      await sleep(randInt(MIN_BURST_DELAY_MS, MAX_BURST_DELAY_MS));
    }
  },
};
