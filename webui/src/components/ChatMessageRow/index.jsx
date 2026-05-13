// Chat Message Row
// Purpose: Defines the Chat Message Row module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { FaDiscord } from 'react-icons/fa';
import { roverBadgeStyle } from '../../lib/roverColor.js';

function roleColors(role) {
  switch (role) {
    case 'admin':
    case 'lockdown':
    case 'lockdown-admin':
      return 'text-amber-300';
    case 'spectator':
      return 'text-slate-400';
    default:
      return 'text-sky-300';
  }
}

function isBotSystemMessage(message) {
  return Boolean(message?.system);
}

function formatTime(ts) {
  const date = new Date(ts);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function displayName(message) {
  return message.nickname || message.socketId?.slice(0, 6) || 'unknown';
}

function DiscordAvatar({ guildIconUrl, userAvatarUrl, label }) {
  if (!guildIconUrl && !userAvatarUrl) return null;
  return (
    <span
      className="flex h-4 w-4 overflow-hidden rounded-full border border-slate-700/80"
      title={label}
    >
      <span
        className={`h-full w-1/2 bg-slate-700/70 ${guildIconUrl ? 'bg-cover' : ''}`}
        style={
          guildIconUrl
            ? {
                backgroundImage: `url(${guildIconUrl})`,
                backgroundPosition: 'left center',
                backgroundSize: '200% 100%',
              }
            : undefined
        }
      />
      <span
        className={`h-full w-1/2 bg-slate-700/70 ${userAvatarUrl ? 'bg-cover' : ''}`}
        style={
          userAvatarUrl
            ? {
                backgroundImage: `url(${userAvatarUrl})`,
                backgroundPosition: 'right center',
                backgroundSize: '200% 100%',
              }
            : undefined
        }
      />
    </span>
  );
}

export function ChatIdentity({ message }) {
  const discordLabel = message.fromDiscord
    ? `${message.discordGuildName || 'Discord'} · ${displayName(message)}`
    : null;
  const isBot = isBotSystemMessage(message);
  const nameClass = isBot ? 'text-emerald-300' : roleColors(message.role);
  return (
    <>
      {message.fromDiscord ? (
        <>
          <FaDiscord className="h-3.5 w-3.5 text-indigo-200" />
          <DiscordAvatar
            guildIconUrl={message.discordGuildIconUrl}
            userAvatarUrl={message.discordUserAvatarUrl}
            label={discordLabel}
          />
        </>
      ) : null}
      <span className={`font-semibold text-[0.85rem] ${nameClass}`}>
        {displayName(message)}
      </span>
      {isBot ? (
        <span className="rounded bg-emerald-900/60 px-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white">
          bot
        </span>
      ) : null}
      {message.roverId && (
        <span
          className="rounded bg-slate-800 px-1 text-[0.7rem]"
          style={roverBadgeStyle(message.roverColor, 0.14)}
        >
          {message.roverId}
        </span>
      )}
    </>
  );
}

function chatRowClass(message) {
  if (isBotSystemMessage(message)) {
    return 'surface-muted relative flex flex-wrap items-start gap-0.5 border border-emerald-500/40 bg-emerald-900/15 text-sm';
  }
  const isAdmin =
    message.role === 'admin' || message.role === 'lockdown' || message.role === 'lockdown-admin';
  return `surface-muted relative flex flex-wrap items-start gap-0.5 text-sm ${
    isAdmin
      ? 'border border-amber-400/30'
      : message.fromDiscord
        ? 'border border-indigo-400/30 bg-indigo-900/20'
        : ''
  }`;
}

export default function ChatMessageRow({ message }) {
  const isBot = isBotSystemMessage(message);
  return (
    <div className={chatRowClass(message)}>
      <ChatIdentity message={message} />
      <span
        className={`min-w-0 break-words leading-tight whitespace-pre-wrap ${isBot ? 'text-emerald-100' : 'text-slate-100'}`}
      >
        {message.text}
      </span>
      <span className="absolute bottom-0.5 right-1 text-[0.65rem] text-slate-400/60">
        {formatTime(message.ts)}
      </span>
    </div>
  );
}

export { chatRowClass };
