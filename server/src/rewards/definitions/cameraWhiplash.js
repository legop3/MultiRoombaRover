const STEP_MS = 220;
const STEPS = 10;

module.exports = {
  id: 'cameraWhiplash',
  name: 'Camera Wiggle',
  goal: 160,
  async run(ctx) {
    const rovers = ctx
      .listOnlineRovers()
      .filter((rover) => Boolean(rover?.cameraServo?.enabled));
    if (!rovers.length) {
      return;
    }

    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      rovers.forEach((rover) => {
        const nudge = (Math.random() * 24 - 12).toFixed(2);
        try {
          ctx.issueCommand(String(rover.id), {
            type: 'servo',
            servo: { nudge: Number(nudge) },
          });
        } catch (err) {
          ctx.logger.warn('cameraWhiplash servo failed', { roverId: rover.id, error: err.message });
        }
      });
      if (step >= STEPS) {
        clearInterval(timer);
      }
    }, STEP_MS);

    ctx.sendAlert({
      color: '#00bcd4',
      title: 'Camera Wiggle',
      message: `Wobble running on ${rovers.length} rover(s).`,
    });
  },
};
