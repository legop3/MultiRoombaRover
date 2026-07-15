// Operator Command Configuration
// Purpose: Owns transport-neutral command names used by site chat and optional integrations.
// Scope: Prevents Discord configuration from defining whether core server commands can be parsed.
const { loadConfig } = require('../../helpers/configLoader');

function getCommandConfig(config = loadConfig()) {
  const commandConfig = config.commands || {};
  const prefix = String(commandConfig.prefix || 'rs').trim() || 'rs';
  const timeStatusCommand = commandConfig.timeStatusCommand === null
    ? ''
    : String(commandConfig.timeStatusCommand || 'ts').trim();

  return { prefix, timeStatusCommand };
}

function parseCommandText(text, config = loadConfig()) {
  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();
  const { prefix, timeStatusCommand } = getCommandConfig(config);
  const normalizedPrefix = prefix.toLowerCase();
  const normalizedTimeStatus = timeStatusCommand.toLowerCase();

  if (normalizedTimeStatus && lower === normalizedTimeStatus) {
    return { matched: true, kind: 'time-status', body: '', action: 'time-status', tokens: [] };
  }

  if (!lower.startsWith(normalizedPrefix)) return { matched: false };
  const nextCharacter = clean.charAt(prefix.length);
  if (nextCharacter && !/\s/.test(nextCharacter)) return { matched: false };

  const body = clean.slice(prefix.length).trim();
  const tokens = body ? body.split(/\s+/) : [];
  return {
    matched: true,
    kind: 'prefixed',
    body,
    action: String(tokens[0] || '').toLowerCase(),
    tokens,
  };
}

module.exports = {
  getCommandConfig,
  parseCommandText,
};
