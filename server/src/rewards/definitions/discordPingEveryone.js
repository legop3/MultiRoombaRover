// Reward Definition: Discord Ping @everyone
// Purpose: Defines the Discord reward that pings @everyone in general. Scope: Provides reward metadata and dispatch parameters for integration handlers.
module.exports = {
  id: 'discordPingEveryone',
  name: 'PING @EVERYONE',
  goal: 20000,
  async run(ctx) {
    ctx.publishEvent({
      source: 'buttonBoxReward',
      type: 'buttonBox.discordPingEveryone',
      payload: {
        message: 'Pinged by button box masher!!',
      },
    });
    ctx.sendAlert({ color: '#ff00e1', title: 'PING @EVERYONE', message: 'Sent @everyone ping to Discord.' });
  },
};
