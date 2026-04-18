const dockPanic = require('./definitions/dockPanic');
const cameraWhiplash = require('./definitions/cameraWhiplash');
const lightStrobe = require('./definitions/lightStrobe');
const ghostTypingSpam = require('./definitions/ghostTypingSpam');
const darkness = require('./definitions/darkness');
const discordStalkerPing = require('./definitions/discordStalkerPing');
const rogueEventSpam = require('./definitions/rogueEventSpam');
const modeJam = require('./definitions/modeJam');
const assignmentRoulette = require('./definitions/assignmentRoulette');
const chatSpam = require('./definitions/chatSpam');

const orderedRewards = [
  dockPanic,
  cameraWhiplash,
  lightStrobe,
  ghostTypingSpam,
  darkness,
  discordStalkerPing,
  rogueEventSpam,
  modeJam,
  assignmentRoulette,
  chatSpam,
];

const rewardById = new Map(orderedRewards.map((reward, idx) => [reward.id, { ...reward, number: idx + 1 }]));

function listRewards() {
  return orderedRewards.map((reward, idx) => ({ ...reward, number: idx + 1 }));
}

function getRewardById(id) {
  return rewardById.get(String(id)) || null;
}

function pickRandomReward(excludeId = null) {
  const list = listRewards().filter((reward) => !excludeId || reward.id !== excludeId);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)] || null;
}

module.exports = {
  listRewards,
  getRewardById,
  pickRandomReward,
};
