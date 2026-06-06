function getConfiguredEntities(homeAssistantService) {
  const entities = homeAssistantService.getState()?.entities;
  return Array.isArray(entities) ? entities : [];
}

function resolveConfiguredEntity(homeAssistantService, rawEntityId, toolId) {
  const entityId = String(rawEntityId || '').trim();
  if (!entityId) throw new Error(`${toolId} requires args.entity_id`);

  const entities = getConfiguredEntities(homeAssistantService);
  const exact = entities.find((entry) => String(entry?.id || '') === entityId);
  if (exact) return { entity: exact, entityId: String(exact.id) };

  // LLM tool calls sometimes drop the Home Assistant domain prefix and send
  // shelf_rgb_bulb instead of light.shelf_rgb_bulb. Suffix matching keeps that
  // forgiving behavior inside the configured-entity allowlist, so the model can
  // recover from a naming slip without gaining access to arbitrary HA entities.
  const suffixMatches = entities.filter((entry) => {
    const configuredId = String(entry?.id || '');
    return configuredId.endsWith(`.${entityId}`);
  });

  if (suffixMatches.length === 1) {
    return { entity: suffixMatches[0], entityId: String(suffixMatches[0].id) };
  }

  // Ambiguous suffixes are rejected because picking one would be riskier than
  // asking the model/user to use the full entity id. The error names the suffix
  // issue directly so future logs point at the real failure mode.
  if (suffixMatches.length > 1) {
    throw new Error(`${toolId} entity_id ambiguous; use the full Home Assistant entity id`);
  }

  throw new Error(`${toolId} entity_id not configured`);
}

module.exports = {
  resolveConfiguredEntity,
};
