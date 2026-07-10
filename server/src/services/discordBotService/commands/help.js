// Discord Help Command
// Purpose: Provides help text for rover bot Discord commands.
// Scope: Returns usage text with the configured command names for this bot instance.
function formatHelp({ commandPrefix = 'rs', timeStatusCommand = 'ts' } = {}) {
  const prefix = String(commandPrefix || 'rs').trim() || 'rs';
  const timeCommand = timeStatusCommand ? String(timeStatusCommand).trim() : '';
  return [
    '**Rover Bot Commands**',
    `\`${prefix} help\` — show this help`,
    `\`${prefix} status [rover]\` — show rover status; rover names can be fuzzy`,
    `\`${prefix} replay [sources]\` — send instant replay; source names can be fuzzy`,
    `\`${prefix} bridge\` — show chat bridge status for this server`,
    `\`${prefix} bridge here <global|private>\` — set chat bridge to this channel`,
    `\`${prefix} bridge mode <global|private>\` — change chat bridge mode`,
    `\`${prefix} bridge off\` — disable chat bridge for this server`,
    `\`${prefix} lights <status|lock|unlock>\` — show or change room light lock state`,
    `\`${prefix} kick <user> [reason]\` — remove a user from their current rover; use \`user | reason\` for multi-word names`,
    `\`${prefix} lock <rover>\` — lock a rover; rover names can be fuzzy`,
    `\`${prefix} unlock <rover>\` — unlock a rover; rover names can be fuzzy`,
    `\`${prefix} mode <open|turns|admin|lockdown>\` — change server mode`,
    `\`${prefix} reason [text|clear]\` — show or set admin mode reason`,
    `\`${prefix} goal [text|clear]\` — show or set global objective`,
    `\`${prefix} verify list\` — list verified users (lockdown admins)`,
    `\`${prefix} verify remove <cookieUserId|nickname>\` — remove verified user; nicknames can be fuzzy or multi-word (lockdown admins)`,
    `\`${prefix} deter list\` — list deterred users (lockdown admins)`,
    `\`${prefix} deter ban <cookieUserId|nickname|ip>\` — deter a user; nicknames can be fuzzy or multi-word (lockdown admins)`,
    `\`${prefix} deter unban <id|cookieUserId|nickname|ip>\` — remove deterrence; nicknames can be fuzzy or multi-word (lockdown admins)`,
    timeCommand ? `\`${timeCommand}\` — show time status` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { formatHelp };
