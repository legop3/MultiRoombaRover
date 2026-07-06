// Discord Kick Command
// Purpose: Removes a connected user from their current rover without applying any persistent moderation state.
// Scope: Resolves an online driver, sends them a UI-visible reason, and releases their current rover assignment.
const Fuse = require('fuse.js');

const DEFAULT_KICK_REASON = 'Removed from rover by admin.';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSearchText(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
}

function splitSelectorAndReason(rawText) {
  const text = normalizeText(rawText);
  if (!text) return { selector: '', reason: '' };
  const pipeIndex = text.indexOf('|');
  if (pipeIndex >= 0) {
    /*
      A pipe delimiter is the escape hatch for multi-word nicknames. Without a
      delimiter the command intentionally treats the first token as the selector
      so quick admin commands stay short: `rs kick bob being reckless`.
    */
    return {
      selector: normalizeText(text.slice(0, pipeIndex)),
      reason: normalizeText(text.slice(pipeIndex + 1)),
    };
  }
  const parts = text.split(/\s+/);
  return {
    selector: normalizeText(parts.shift()),
    reason: normalizeText(parts.join(' ')),
  };
}

function buildKickCandidates({ io, roverManager, assignmentService, getNickname }) {
  return Array.from(io.sockets.sockets.values())
    .map((socket) => {
      const socketId = normalizeText(socket?.id);
      const assignedRoverId = assignmentService?.getAssignedRover?.(socketId) || null;
      const primaryRoverId = roverManager.getPrimaryRoverForSocket(socketId);
      const roverId = assignedRoverId || primaryRoverId || null;
      if (!socketId || !roverId) return null;
      const nickname = normalizeText(getNickname(socket));
      const username = normalizeText(socket?.data?.user?.username);
      return {
        socket,
        socketId,
        roverId,
        nickname,
        username,
        label: nickname || username || socketId.slice(0, 6),
        searchSocketId: normalizeSearchText(socketId),
        searchShortSocketId: normalizeSearchText(socketId.slice(0, 6)),
        searchNickname: normalizeSearchText(nickname),
        searchUsername: normalizeSearchText(username),
      };
    })
    .filter(Boolean);
}

function resolveKickTarget(selector, candidates) {
  const query = normalizeSearchText(selector);
  if (!query) return { error: 'Specify a user to kick. Example: `rs kick nickname reason`' };
  const exact = candidates.filter((entry) => (
    entry.searchSocketId === query ||
    entry.searchShortSocketId === query ||
    entry.searchNickname === query ||
    entry.searchUsername === query
  ));
  if (exact.length === 1) return { target: exact[0] };
  if (exact.length > 1) {
    return { error: `User matched multiple drivers: ${exact.map((entry) => entry.label).join(', ')}.` };
  }
  const fuse = new Fuse(candidates, {
    includeScore: true,
    threshold: 0.38,
    ignoreLocation: true,
    keys: [
      { name: 'nickname', weight: 0.7 },
      { name: 'username', weight: 0.2 },
      { name: 'socketId', weight: 0.1 },
    ],
  });
  const results = fuse.search(selector);
  if (!results.length) return { error: 'User not found among current rover drivers.' };
  const first = results[0];
  const second = results[1];
  if (second && Math.abs(Number(second.score || 0) - Number(first.score || 0)) < 0.08) {
    return {
      error: `User matched multiple drivers: ${results.slice(0, 5).map((entry) => entry.item.label).join(', ')}.`,
    };
  }
  return { target: first.item };
}

function createKickCommand({ io, roverManager, getNickname, sanitizeMentions }) {
  return async function handleKickCommand(message, rawText) {
    const { selector, reason } = splitSelectorAndReason(rawText);
    const assignmentService = require('../../assignmentService');
    const candidates = buildKickCandidates({
      io,
      roverManager,
      assignmentService,
      getNickname,
    });
    const resolved = resolveKickTarget(selector, candidates);
    if (resolved.error) {
      await message.reply({ content: sanitizeMentions(resolved.error), allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const target = resolved.target;
    const removalReason = reason || DEFAULT_KICK_REASON;
    /*
      The command deliberately calls the notice-aware release helper instead of
      roverManager.releaseControl. That keeps admin kicks aligned with automated
      removals and gives the driver a stable explanation in the video panel.
    */
    assignmentService.forceReleaseWithNotice(target.roverId, target.socketId, {
      title: 'Removed by admin',
      message: removalReason,
      reasonCode: 'admin-kick',
      actor: message.author?.id || null,
    });
    await message.reply({
      content: sanitizeMentions(`Removed ${target.label} from ${target.roverId}: ${removalReason}`),
      allowedMentions: { parse: [], repliedUser: false },
    });
  };
}

module.exports = {
  createKickCommand,
};
