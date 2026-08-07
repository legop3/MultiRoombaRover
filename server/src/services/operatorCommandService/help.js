// Operator Command Help
// Purpose: Generates organized command help from one descriptive command catalogue.
// Scope: Keeps shared command discovery consistent while allowing Discord-only extensions to stay transport-specific.
const { CATEGORIES, buildCommandRegistry } = require('./registry');

function renderDetailed(name, entry, isFeatureEnabled) {
  const details = [`**${name}**`, entry.summary];
  if (entry.access) details.push(`Permission: ${entry.access}`);
  if (entry.requiredFeature) details.push(`Required feature: ${entry.requiredFeature}`);
  if (entry.requiredFeature && !isFeatureEnabled(entry.requiredFeature)) details.push('Availability: unavailable on this server');
  details.push('Usage:', ...entry.usage.map((usage) => `- \`${usage}\``));
  return details.join('\n');
}

function formatHelp({ commandPrefix = 'rs', timeStatusCommand = 'ts', topic = '', includeDiscord = true, isFeatureEnabled = () => true } = {}) {
  const prefix = String(commandPrefix || 'rs').trim() || 'rs';
  const timeCommand = timeStatusCommand ? String(timeStatusCommand).trim() : '';
  const entries = buildCommandRegistry(prefix, timeCommand);
  const normalizedTopic = String(topic || '').trim().toLowerCase();

  if (entries[normalizedTopic] && (normalizedTopic !== 'bridge' || includeDiscord)) {
    return renderDetailed(normalizedTopic, entries[normalizedTopic], isFeatureEnabled);
  }

  const requestedCategory = normalizedTopic === 'feature' ? 'features' : normalizedTopic;
  const categoryNames = requestedCategory && CATEGORIES[requestedCategory]
    ? [requestedCategory]
    : ['system', 'admin', 'features', ...(includeDiscord ? ['discord'] : [])];

  const output = ['**Rover Bot Commands**'];
  for (const categoryName of categoryNames) {
    if (categoryName === 'discord' && !includeDiscord) continue;
    const category = CATEGORIES[categoryName];
    output.push('', `**${category.title}**`);
    for (const name of category.names) {
      const entry = entries[name];
      if (!entry?.usage?.length) continue;
      const availability = entry.requiredFeature && !isFeatureEnabled(entry.requiredFeature) ? ' *(unavailable)*' : '';
      // A colon stays readable in both Discord and site chat while avoiding the
      // typographic punctuation that made command help awkward to copy or edit.
      output.push(`- \`${entry.usage[0]}\`: ${entry.summary}${availability}`);
    }
  }
  output.push('', `Use \`${prefix} help <command|category>\` for details.`);
  return output.join('\n');
}

module.exports = { formatHelp };
