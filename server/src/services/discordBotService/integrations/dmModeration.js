// Discord DM Moderation Integrations
// Purpose: Sends verification/private-access DMs and resolves reactions.
// Scope: Handles moderation request workflows tied to Discord DMs.
function createDmModerationHandlers(deps) {
  const {
    logger,
    client,
    lockdownAdminIds,
    attachDmMessage,
    getRequestByMessageId,
    approveRequest,
    denyRequest,
    attachPrivateAccessDmMessage,
    getPrivateAccessRequestByMessageId,
    approvePrivateAccessRequest,
    denyPrivateAccessRequest,
    isLockdownAdminUser,
    sanitizeMentions,
  } = deps;

  const APPROVE = '✅';
  const DENY = '❌';

  async function sendVerificationRequestDms(event) {
    const payload = event?.payload || {};
    const requestId = payload.id;
    if (!requestId) return;
    const content = [`**Verification Request**`, `Request ID: \`${requestId}\``, `Nickname: ${sanitizeMentions(payload.nickname || 'unknown')}`, '', `React with ${APPROVE} to approve or ${DENY} to deny.`].join('\n');
    await Promise.all(Array.from(lockdownAdminIds).map(async (adminId) => {
      try {
        const user = await client.users.fetch(String(adminId));
        if (!user) return;
        const dm = await user.createDM();
        const message = await dm.send({ content, allowedMentions: { parse: [] } });
        try { await message.react(APPROVE); await message.react(DENY); } catch {}
        attachDmMessage(requestId, message.id, adminId);
      } catch (err) {
        logger.warn('Failed to DM lockdown admin for verification request', { requestId, adminId, error: err.message });
      }
    }));
  }

  async function sendPrivateRoverAccessRequestDms(event) {
    const payload = event?.payload || {};
    const requestId = payload.id;
    if (!requestId) return;
    const content = [`**Private Rover Access Request**`, `Request ID: \`${requestId}\``, '', `React with ${APPROVE} to approve or ${DENY} to deny.`].join('\n');
    await Promise.all(Array.from(lockdownAdminIds).map(async (adminId) => {
      try {
        const user = await client.users.fetch(String(adminId));
        if (!user) return;
        const dm = await user.createDM();
        const message = await dm.send({ content, allowedMentions: { parse: [] } });
        try { await message.react(APPROVE); await message.react(DENY); } catch {}
        attachPrivateAccessDmMessage(requestId, message.id, adminId);
      } catch (err) {
        logger.warn('Failed to DM lockdown admin for private rover access request', { requestId, adminId, error: err.message });
      }
    }));
  }

  async function handleVerificationReaction(reaction, user) {
    if (!reaction || !user || user.bot || !isLockdownAdminUser(user.id)) return;
    const emoji = reaction.emoji?.name;
    if (emoji !== APPROVE && emoji !== DENY) return;
    if (reaction.message?.partial || reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }
    const linked = getRequestByMessageId(reaction.message?.id);
    if (!linked?.request || linked.request.status !== 'pending') return;
    if (emoji === APPROVE) approveRequest(linked.request.id, user.id);
    else denyRequest(linked.request.id, user.id);
  }

  async function handlePrivateAccessReaction(reaction, user) {
    if (!reaction || !user || user.bot || !isLockdownAdminUser(user.id)) return;
    const emoji = reaction.emoji?.name;
    if (emoji !== APPROVE && emoji !== DENY) return;
    if (reaction.message?.partial || reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }
    const linked = getPrivateAccessRequestByMessageId(reaction.message?.id);
    if (!linked?.request || linked.request.status !== 'pending') return;
    if (emoji === APPROVE) approvePrivateAccessRequest(linked.request.id, user.id);
    else denyPrivateAccessRequest(linked.request.id, user.id);
  }

  return {
    sendVerificationRequestDms,
    sendPrivateRoverAccessRequestDms,
    handleVerificationReaction,
    handlePrivateAccessReaction,
  };
}

module.exports = { createDmModerationHandlers };
