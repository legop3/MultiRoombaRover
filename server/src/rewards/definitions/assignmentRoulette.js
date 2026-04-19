module.exports = {
  id: 'assignmentRoulette',
  name: 'Rover Reassignment',
  goal: 300,
  async run(ctx) {
    const moved = ctx.rerollAssignments();
    ctx.sendAlert({
      color: '#8bc34a',
      title: 'Rover Reassignment',
      message: `Reassigned ${moved} user(s).`,
    });
  },
};
