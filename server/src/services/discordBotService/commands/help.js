// Discord Help Command
// Purpose: Provides help text for rover bot Discord commands.
// Scope: Returns static command usage text.
function formatHelp() {
  return [
    '**Rover Bot Commands**',
    '`rs help` — show this help',
    '`rs status [id]` — show rover status (all or one)',
    '`rs replay [sources]` — send instant replay (room/rover)',
    '`rs bridge` — show chat bridge status for this server',
    '`rs bridge here <global|private>` — set chat bridge to this channel',
    '`rs bridge mode <global|private>` — change chat bridge mode',
    '`rs bridge off` — disable chat bridge for this server',
    '`rs lock <id>` — lock a rover',
    '`rs unlock <id>` — unlock a rover',
    '`rs mode <open|turns|admin|lockdown>` — change server mode',
    '`rs reason [text|clear]` — show or set admin mode reason',
    '`rs goal [text|clear]` — show or set global objective',
    '`rs verify list` — list verified users (lockdown admins)',
    '`rs verify remove <cookieUserId|nickname>` — remove verified user (lockdown admins)',
    '`rs deter list` — list deterred users (lockdown admins)',
    '`rs deter ban <cookieUserId|nickname|ip> [reason]` — deter a user (lockdown admins)',
    '`rs deter unban <id|cookieUserId|nickname|ip>` — remove deterrence (lockdown admins)',
    '`ts` — show time status',
  ].join('\n');
}

module.exports = { formatHelp };
