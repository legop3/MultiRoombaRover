const COLORS = ['#f44336', '#ff9800', '#ffeb3b', '#4caf50', '#2196f3', '#9c27b0', '#e91e63'];
const TITLES = ['RARARARARARARARARE', 'CHIRPET CHIRPET CHIRPET', 'meowmowmoowmomwowm', 'theleash'];

module.exports = {
  id: 'rogueEventSpam',
  name: 'Event Flood',
  goal: 45,
  async run(ctx) {
    for (let i = 0; i < 10; i += 1) {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const title = TITLES[Math.floor(Math.random() * TITLES.length)];
      const message = `Event ${i + 1} / 10`;
      ctx.sendAlert({ color, title, message });
    }
  },
};
