// Chat Message Row
// Purpose: Defines the Chat Message Row module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useState } from 'react';
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

function isBotMessage(message) {
  return Boolean(message?.bot);
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
      className="flex h-4 w-4 shrink-0 overflow-hidden rounded-none border border-slate-700/80"
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

function ProfileAvatar({ imageUrl, label }) {
  if (!imageUrl) return null;
  return (
    <span className="flex h-4 w-4 shrink-0 overflow-hidden rounded-none border border-slate-700/80" title={label}>
      <span
        className="h-full w-full bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${imageUrl})` }}
      />
    </span>
  );
}

export function ChatIdentity({ message }) {
  const discordLabel = message.fromDiscord
    ? `${message.discordGuildName || 'Discord'} · ${displayName(message)}`
    : null;
  const isBot = isBotMessage(message);
  const nameClass = isBot ? 'text-emerald-300' : roleColors(message.role);
  return (
    <span className="inline-flex min-w-0 items-center gap-0.5 align-middle">
      {message.fromDiscord ? (
        <FaDiscord className="h-4 w-4 shrink-0 text-indigo-200" />
      ) : null}
      <span className={`font-semibold text-[0.85rem] ${nameClass}`}>
        {displayName(message)}
      </span>
      <ProfileAvatar imageUrl={message.profileImage} label={discordLabel || displayName(message)} />
      {!message.profileImage ? (
        <DiscordAvatar
          guildIconUrl={message.discordGuildIconUrl}
          userAvatarUrl={message.discordUserAvatarUrl}
          label={discordLabel}
        />
      ) : null}
      {isBot ? (
        <span className="shrink-0 rounded bg-emerald-900/60 px-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white">
          bot
        </span>
      ) : null}
      {message.roverId && (
        <span
          className="shrink-0 rounded bg-slate-800 px-1 text-[0.7rem]"
          style={roverBadgeStyle(message.roverColor, 0.14)}
        >
          {message.roverId}
        </span>
      )}
    </span>
  );
}

function chatRowClass(message) {
  if (isBotMessage(message)) {
    return 'surface-muted flex items-center gap-0.5 border border-emerald-500/40 bg-emerald-900/15 text-sm';
  }
  const isAdmin =
    message.role === 'admin' || message.role === 'lockdown' || message.role === 'lockdown-admin';
  return `surface-muted flex items-center gap-0.5 text-sm ${
    isAdmin
      ? 'border border-amber-400/30'
      : message.fromDiscord
        ? 'border border-indigo-400/30 bg-indigo-900/20'
        : ''
  }`;
}

export default function ChatMessageRow({ message }) {
  const isBot = isBotMessage(message);
  const [open, setOpen] = useState(false);
  const toolCalls = Array.isArray(message?.toolCalls) ? message.toolCalls : [];
  const hasText = Boolean(String(message?.text || '').trim());
  return (
    <div className={chatRowClass(message)}>
      <span
        className={`min-w-0 flex-1 break-words leading-tight whitespace-pre-wrap ${isBot ? 'text-emerald-100' : 'text-slate-100'}`}
      >
        <ChatIdentity message={message} />{hasText ? ` ${message.text}` : ''}
        {toolCalls.length > 0 ? (
          <span className="mt-0.5 block">
            <button
              type="button"
              className="rounded border border-slate-600/70 bg-slate-800/60 px-1 py-[1px] text-[0.65rem] text-slate-200 hover:bg-slate-700/70"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? '▼' : '▶'} Tools ({toolCalls.length})
            </button>
            {open ? (
              <div className="mt-0.5 rounded border border-slate-700/70 bg-slate-900/70 p-0.5 text-[0.68rem] text-slate-200">
                {toolCalls.map((entry, idx) => {
                  const status = String(entry?.status || 'unknown');
                  const statusLabel = status === 'ok' ? 'ok' : status === 'blocked' ? 'blocked' : status === 'error' ? 'error' : 'unknown';
                  const argsText = JSON.stringify(entry?.args && typeof entry.args === 'object' ? entry.args : {});
                  return (
                    <div key={`${entry?.tool || 'tool'}-${idx}`} className="mb-0.5 last:mb-0">
                      <div>{statusLabel} {entry?.tool || 'unknown'} args={argsText}</div>
                      {entry?.error ? <div className="text-rose-300">error: {String(entry.error)}</div> : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="ml-auto shrink-0 text-[0.65rem] text-slate-400/60">
        {formatTime(message.ts)}
      </span>
    </div>
  );
}

export { chatRowClass };
