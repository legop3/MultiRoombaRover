const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function randLetter() {
  return LETTERS[Math.floor(Math.random() * LETTERS.length)];
}

module.exports = {
  id: 'chatSpam',
  name: 'Chat Spam',
  goal: 50,
  async run(ctx) {
    const nickname = randLetter();
    const messageCount = 8;
    for (let i = 0; i < messageCount; i += 1) {
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
  },
};
