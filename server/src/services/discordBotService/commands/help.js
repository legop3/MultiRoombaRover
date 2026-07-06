// Discord Help Command
// Purpose: Provides help text for rover bot Discord commands.
// Scope: Returns static command usage text.
function formatHelp() {
  return [
    '**Rover Bot Commands**',
    '`rs help` — show this help',
    '`rs status [rover]` — show rover status; rover names can be fuzzy',
    '`rs replay [sources]` — send instant replay; source names can be fuzzy',
    '`rs bridge` — show chat bridge status for this server',
    '`rs bridge here <global|private>` — set chat bridge to this channel',
    '`rs bridge mode <global|private>` — change chat bridge mode',
    '`rs bridge off` — disable chat bridge for this server',
    '`rs lights <status|lock|unlock>` — show or change room light lock state',
    '`rs kick <user> [reason]` — remove a user from their current rover; use `user | reason` for multi-word names',
    '`rs lock <rover>` — lock a rover; rover names can be fuzzy',
    '`rs unlock <rover>` — unlock a rover; rover names can be fuzzy',
    '`rs mode <open|turns|admin|lockdown>` — change server mode',
    '`rs reason [text|clear]` — show or set admin mode reason',
    '`rs goal [text|clear]` — show or set global objective',
    '`rs verify list` — list verified users (lockdown admins)',
    '`rs verify remove <cookieUserId|nickname>` — remove verified user; nicknames can be fuzzy or multi-word (lockdown admins)',
    '`rs deter list` — list deterred users (lockdown admins)',
    '`rs deter ban <cookieUserId|nickname|ip>` — deter a user; nicknames can be fuzzy or multi-word (lockdown admins)',
    '`rs deter unban <id|cookieUserId|nickname|ip>` — remove deterrence; nicknames can be fuzzy or multi-word (lockdown admins)',
    '`ts` — show time status',
  ].join('\n');
}

module.exports = { formatHelp };
