// User and idle commands share one dispatch contract, while only the trusted
// idle entry point can bypass per-item user locks.
const { buildEntity, buildCommand } = require('./entityHelpers');

function assertAccess(actor = {}) {
  if (!['user', 'admin', 'lockdown'].includes(actor.role)) throw new Error('Spectators cannot control activities');
  if (actor.mode === 'lockdown' && actor.role !== 'lockdown') throw new Error('Server in lockdown');
  if (actor.mode === 'admin' && !['admin', 'lockdown'].includes(actor.role)) throw new Error('Admin mode: admins only');
}

function createActions({ getConfig, ha, locks }) {
  async function execute(id, actionId, values, actor, idle = false) {
    if (!idle) assertAccess(actor);
    const config = getConfig();
    if (!config.enabled) throw new Error('Home Assistant activities are disabled');
    const item = config.items.find((entry) => entry.id === id);
    if (!item) throw new Error('Unknown activity item');
    if (!idle && locks.isLocked(id) && !['admin', 'lockdown'].includes(actor.role)) throw new Error('This item is locked');
    if (!ha.enabled || !ha.isConnected()) throw new Error('Home Assistant is offline');
    const entity = buildEntity(item, ha.getRawEntitySnapshot(id), ha.getServiceDescriptions());
    if (!entity.available) throw new Error('This item is unavailable');
    const command = buildCommand(entity, actionId, values);
    // Let HA process independent commands normally; an outstanding service
    // response must not block later user changes or configured idle cleanup.
    await ha.callHomeAssistantService(command.domain, command.service, command.data);
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
        const entity = buildEntity(item, ha.getRawEntitySnapshot(item.id), ha.getServiceDescriptions());
        const actionId = item.idleAction.includes('.') ? item.idleAction : `${item.id.split('.')[0]}.${item.idleAction}`;
        const action = entity.actions.find((candidate) => candidate.id === actionId);
        if (!action) throw new Error('Configured idle action is not available');
        let values = {};
        // A single-input action accepts its plain value. Compound actions use
        // a JSON object so admins can specify exactly which properties idle
        // should change, without inventing a separate per-domain idle policy.
        if (action.fields.length === 1) {
          const field = action.fields[0];
          const value = item.idleValue ?? '';
          values[field.key] = ['toggle', 'color', 'button'].includes(field.type) ? JSON.parse(value) : value;
          if (field.type === 'select') {
            values[field.key] = field.options.find((option) => String(option.value) === value)?.value ?? value;
          }
        } else if (item.idleValue?.trim()) {
          values = JSON.parse(item.idleValue);
        }
        await execute(item.id, actionId, values, null, true);
        results.push({ id: item.id, ok: true });
      } catch (error) {
        results.push({ id: item.id, ok: false, error: error.message });
      }
    }
    return { action: 'homeAssistantActivitiesIdle', results };
  }
  return { act: (id, actionId, values, actor) => execute(id, actionId, values, actor), runIdleActions };
}

module.exports = { createActions, assertAccess };
