// User and automated commands share validation; only trusted automation bypasses user permissions.
const { buildEntity, buildCommand } = require('./entityHelpers');

function assertAccess(actor = {}) {
  if (!['user', 'admin', 'lockdown'].includes(actor.role)) throw new Error('Spectators cannot control activities');
  if (actor.mode === 'lockdown' && actor.role !== 'lockdown') throw new Error('Server in lockdown');
  if (actor.mode === 'admin' && !['admin', 'lockdown'].includes(actor.role)) throw new Error('Admin mode: admins only');
}

function createActions({ getConfig, ha, locks }) {
  async function execute(id, value, actor, automated = false) {
    if (!automated) assertAccess(actor);
    const config = getConfig();
    if (!config.enabled) throw new Error('Activity Controls are disabled');
    const item = config.items.find((entry) => entry.id === id);
    if (!item) throw new Error('Unknown activity item');
    if (!automated && locks.isLocked(id) && !['admin', 'lockdown'].includes(actor.role)) throw new Error('This item is locked');
    if (!automated && item.readOnly && !['admin', 'lockdown'].includes(actor.role)) throw new Error('This item is read-only for users');
    if (!ha.enabled || !ha.isConnected()) throw new Error('Home Assistant is offline');
    const entity = buildEntity(item, ha.getRawEntitySnapshot(id));
    if (!entity.available) throw new Error('This item is unavailable');
    const command = buildCommand(entity, value);
    // Let HA process independent commands normally; an outstanding service
    // response must not block later user changes or configured idle cleanup.
    await ha.callHomeAssistantService(entity.domain, command.service, command.data);
  }

  async function runAutomation(trigger, shouldRun = () => true) {
    const config = getConfig();
    if (!config.enabled) return { action: trigger, skipped: true };
    const results = [];
    // Catch per item so one offline integration cannot prevent the remaining
    // configured actions from running for this trigger.
    for (const item of config.items) {
      // Stop remaining writes if presence or mode changed while HA was responding.
      if (!shouldRun()) break;
      const setting = item.automations?.[trigger];
      if (!setting?.action || setting.action === 'unchanged') continue;
      try {
        const entity = buildEntity(item, ha.getRawEntitySnapshot(item.id));
        if (entity.type === 'readOnly') continue;
        if ((setting.action === 'press') !== (entity.type === 'button')) throw new Error('Automation action does not match the control type');
        // The admin form omits an empty optional string. Treat that as empty
        // text so clearing a message works; other types still reject it through
        // their normal value validation rather than silently receiving zero.
        await execute(item.id, setting.action === 'press' ? 'press' : (setting.value ?? ''), null, true);
        results.push({ id: item.id, ok: true });
      } catch (error) {
        results.push({ id: item.id, ok: false, error: error.message });
      }
    }
    return { action: trigger, results };
  }
  return { act: (id, value, actor) => execute(id, value, actor), runAutomation,
    runIdleActions: () => runAutomation('idle') };
}

module.exports = { createActions, assertAccess };
