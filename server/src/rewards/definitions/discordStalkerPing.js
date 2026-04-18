module.exports = {
  id: 'discordStalkerPing',
  name: 'Stalker Ping',
  goal: 150,
  async run(ctx) {
    ctx.publishEvent({
      source: 'buttonBoxReward',
      type: 'buttonBox.discordStalkerPing',
      payload: {
        message: 'Pinged by button box masher!!',
      },
    });
    ctx.sendAlert({ color: '#5865f2', title: 'Stalker Ping', message: 'Sent stalker ping to Discord.' });
  },
};
