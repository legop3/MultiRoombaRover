// Reward Definition: Discord Stalker Ping
// Purpose: Defines the Discord ping reward that notifies configured channels/users. Scope: Provides reward metadata and dispatch parameters for integration handlers.
module.exports = {
  id: 'discordStalkerPing',
  name: 'Discord Ping',
  goal: 9000,
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
