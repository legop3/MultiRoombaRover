// User and idle commands share one dispatch contract, while only the trusted
// idle entry point can bypass per-item user locks.
const { buildEntity, buildCommand } = require('./entityHelpers');

function assertAccess(actor = {}) {
  if (!['user', 'admin', 'lockdown'].includes(actor.role)) throw new Error('Spectators cannot control activities');
  if (actor.mode === 'lockdown' && actor.role !== 'lockdown') throw new Error('Server in lockdown');
  if (actor.mode === 'admin' && !['admin', 'lockdown'].includes(actor.role)) throw new Error('Admin mode: admins only');
}

function createActions({ getConfig, ha, locks }) {
  async function execute(id, value, actor, idle = false) {
    if (!idle) assertAccess(actor);
    const config = getConfig();
    if (!config.enabled) throw new Error('Activity Controls are disabled');
    const item = config.items.find((entry) => entry.id === id);
    if (!item) throw new Error('Unknown activity item');
    if (!idle && locks.isLocked(id) && !['admin', 'lockdown'].includes(actor.role)) throw new Error('This item is locked');
    if (!ha.enabled || !ha.isConnected()) throw new Error('Home Assistant is offline');
    const entity = buildEntity(item, ha.getRawEntitySnapshot(id));
    if (!entity.available) throw new Error('This item is unavailable');
    const command = buildCommand(entity, value);
    // Let HA process independent commands normally; an outstanding service
    // response must not block later user changes or configured idle cleanup.
    await ha.callHomeAssistantService(entity.domain, command.service, command.data);
  }

  async function runIdleActions() {
    const config = getConfig();
    if (!config.enabled) return { action: 'homeAssistantActivitiesIdle', skipped: true };
    const results = [];
    // Catch per item so one offline integration cannot prevent the remaining
    // configured cleanup actions from running during this idle window.
    for (const item of config.items) {
      if (!item.idleAction || item.idleAction === 'unchanged' || item.readOnly) continue;
      try {
        const entity = buildEntity(item, ha.getRawEntitySnapshot(item.id));
        if (entity.type === 'readOnly') continue;
        if ((item.idleAction === 'press') !== (entity.type === 'button')) throw new Error('Idle action does not match the control type');
        // The admin form omits an empty optional string. Treat that as empty
        // text so clearing a message works; other types still reject it through
        // their normal value validation rather than silently receiving zero.
        await execute(item.id, item.idleAction === 'press' ? 'press' : (item.idleValue ?? ''), null, true);
        results.push({ id: item.id, ok: true });
      } catch (error) {
        results.push({ id: item.id, ok: false, error: error.message });
      }
    }
    return { action: 'homeAssistantActivitiesIdle', results };
  }
  return { act: (id, value, actor) => execute(id, value, actor), runIdleActions };
}

module.exports = { createActions, assertAccess };
