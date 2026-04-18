const DOCK_COMMAND_BASE64 = Buffer.from([143]).toString('base64');

module.exports = {
  id: 'dockPanic',
  name: 'All Dock',
  goal: 180,
  async run(ctx) {
    const rovers = ctx.listOnlineRovers();
    rovers.forEach((rover) => {
      try {
        ctx.issueCommand(String(rover.id), { type: 'raw', raw: DOCK_COMMAND_BASE64 });
      } catch (err) {
        ctx.logger.warn('dockPanic failed', { roverId: rover.id, error: err.message });
      }
    });
    ctx.sendAlert({
      color: '#ff9800',
      title: 'All Dock',
      message: `Issued seek-dock to ${rovers.length} rover(s).`,
    });
  },
};
