// Reward Definition: Assignment Roulette
// Purpose: Defines the assignment-roulette reward for reshuffling control assignments. Scope: Encodes reward identity, messaging, and runtime action parameters.
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
