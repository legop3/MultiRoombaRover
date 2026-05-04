// Chat Context Builders
// Purpose: Builds normalized chat message/typing payloads and rover context snapshots.
// Scope: Encapsulates chat DTO construction and rover/driver metadata extraction.
const { v4: uuidv4 } = require('uuid');
const io = require('../../globals/io');
const roverManager = require('../roverManager');
const { getRole } = require('../roleService');
const { describeAssignment } = require('../assignmentService');
const { getNickname } = require('../nicknameService');

function resolveRoverId(socketId) {
  const primary = roverManager.getPrimaryRoverForSocket(socketId);
  if (primary) return primary;
  const assignment = describeAssignment(socketId);
  return assignment?.roverId || null;
}

function resolveRoverColor(roverId) {
  if (!roverId) return null;
  const record = roverManager.rovers.get(String(roverId));
  return record?.meta?.color || null;
}

function isPrivateClosedRoverId(roverId) {
  if (!roverId) return false;
  return roverManager.canReplayRoverId(roverId) !== true;
}

function isChargingFromSensors(sensors = {}) {
  const label = String(sensors?.chargingState?.label || '').toLowerCase();
  if (label === 'waiting' || label === 'full charging' || label === 'trickle charging') return true;
  const code = sensors?.chargingState?.code;
  return code === 2 || code === 3 || code === 4;
}

function buildRoverCtxSnapshot(roverId) {
  if (!roverId) return null;
  const key = String(roverId);
  const record = roverManager.rovers.get(key);
  if (!record) return null;
  const sensors = record?.lastSensor?.decoded || {};
  const batteryState = record?.batteryState || null;
  const { getActiveDrivers } = require('../turnService');
  const activeDrivers = getActiveDrivers();
  const driverSocketId = activeDrivers[key] || record?.drivers?.values?.().next?.().value || null;
  const charging = isChargingFromSensors(sensors);
  const docked = Boolean(sensors?.chargingSources?.homeBase);
  const wheelsOffGround = Boolean(sensors?.bumpsAndWheelDrops?.wheelDropLeft && sensors?.bumpsAndWheelDrops?.wheelDropRight);
  const latestDistanceM = Math.round((Math.abs(Number(sensors?.distanceMm) || 0) / 1000) * 10) / 10;
  const latestTurnDeg = Math.round(Math.abs(Number(sensors?.angleDeg) || 0));
  const latestBumps = (sensors?.bumpsAndWheelDrops?.bumpLeft ? 0.5 : 0) + (sensors?.bumpsAndWheelDrops?.bumpRight ? 0.5 : 0);
  const light = sensors?.lightBumper || {};
  const contactState = docked ? 'clear' : latestBumps >= 0.5 ? 'bumps_recent' : sensors?.wall || light.left || light.frontLeft || light.centerLeft || light.centerRight || light.frontRight || light.right ? 'wall_brush' : 'clear';
  const hazardState = docked ? 'normal' : sensors?.virtualWall ? 'virtual_wall_seen' : sensors?.cliffLeft || sensors?.cliffFrontLeft || sensors?.cliffFrontRight || sensors?.cliffRight ? 'cliff_alert' : 'normal';
  const mobilityState = wheelsOffGround ? 'wheels_off_ground' : 'normal';
  const baseScore = Math.min(100, Math.round(Math.min(45, latestDistanceM * 25) + Math.min(30, latestTurnDeg / 12) + Math.min(25, latestBumps * 12)));
  const activityScore = Math.max(0, Math.min(100, baseScore + (contactState === 'wall_brush' ? 6 : 0) + (contactState === 'bumps_recent' ? 12 : 0) + (hazardState !== 'normal' ? 8 : 0) + (wheelsOffGround ? -20 : 0)));
  const activityBand = activityScore >= 75 ? 'intense' : activityScore >= 50 ? 'high' : activityScore >= 25 ? 'medium' : activityScore >= 8 ? 'low' : 'idle';
  const moving = latestDistanceM > 0.05 || latestTurnDeg > 10;
  let statusTag = 'idle';
  if (charging) statusTag = 'charging';
  else if (docked) statusTag = 'docked';
  else if (driverSocketId && moving) statusTag = 'driving';
  else if (driverSocketId) statusTag = 'active-idle';

  return {
    id: key,
    status_tag: statusTag,
    battery_low: Boolean(batteryState?.warnActive || batteryState?.urgentActive),
    docked,
    charging,
    wheels_off_ground: wheelsOffGround,
    contact_state: contactState,
    hazard_state: hazardState,
    mobility_state: mobilityState,
    activity_score: activityScore,
    activity_band: activityBand,
    activity_trend: 'steady',
    activity_30s: {
      distance_m: latestDistanceM,
      turn_deg: latestTurnDeg,
      bumps: latestBumps,
    },
  };
}

function buildMessage(socket, text, meta = {}) {
  const roverId = meta.roverId || resolveRoverId(socket?.id);
  const roverColor = meta.roverColor ?? resolveRoverColor(roverId);
  return {
    id: uuidv4(),
    ts: Date.now(),
    socketId: socket?.id || null,
    nickname: meta.nickname || getNickname(socket) || null,
    role: meta.role || getRole(socket),
    roverId,
    roverColor,
    fromDiscord: Boolean(meta.fromDiscord),
    discordGuildId: meta.discordGuildId || null,
    discordGuildName: meta.discordGuildName || null,
    discordGuildIconUrl: meta.discordGuildIconUrl || null,
    discordChannelId: meta.discordChannelId || null,
    discordUserId: meta.discordUserId || null,
    discordUserName: meta.discordUserName || null,
    discordUserAvatarUrl: meta.discordUserAvatarUrl || null,
    roverCtx: meta.roverCtx || null,
    text,
    tts: meta.tts || null,
    system: Boolean(meta.system),
    bot: Boolean(meta.bot),
  };
}

function buildTypingPayload(socket, meta = {}) {
  const roverId = meta.roverId || resolveRoverId(socket?.id);
  const roverColor = meta.roverColor ?? resolveRoverColor(roverId);
  const socketId = socket?.id || null;
  const fromDiscord = Boolean(meta.fromDiscord);
  let typingId = meta.typingId || null;
  if (!typingId) {
    if (fromDiscord) {
      if (meta.discordUserId) typingId = `discord:${meta.discordUserId}`;
      else if (meta.discordUserName) typingId = `discord:${meta.discordUserName}`;
      else if (meta.nickname) typingId = `discord:${meta.nickname}`;
      else typingId = 'discord:unknown';
    } else if (socketId) typingId = `socket:${socketId}`;
    else if (meta.nickname) typingId = `socket:${meta.nickname}`;
    else typingId = 'socket:unknown';
  }
  return {
    id: uuidv4(),
    ts: Date.now(),
    typingId,
    isTyping: Boolean(meta.isTyping),
    socketId,
    nickname: meta.nickname || getNickname(socket) || null,
    role: meta.role || getRole(socket),
    roverId,
    roverColor,
    fromDiscord,
    discordGuildId: meta.discordGuildId || null,
    discordGuildName: meta.discordGuildName || null,
    discordGuildIconUrl: meta.discordGuildIconUrl || null,
    discordChannelId: meta.discordChannelId || null,
    discordUserId: meta.discordUserId || null,
    discordUserName: meta.discordUserName || null,
    discordUserAvatarUrl: meta.discordUserAvatarUrl || null,
  };
}

module.exports = {
  resolveRoverId,
  isPrivateClosedRoverId,
  buildRoverCtxSnapshot,
  buildMessage,
  buildTypingPayload,
};
