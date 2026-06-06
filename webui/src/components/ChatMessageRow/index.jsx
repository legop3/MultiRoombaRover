// Chat Message Row
// Purpose: Defines the Chat Message Row module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useState } from 'react';
import { FaDiscord } from 'react-icons/fa';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import RoverLabel from '../RoverLabel/index.jsx';

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

// The chat rows use py-0.5 for their compact vertical rhythm, but the desired avatar
// treatment is edge-to-edge inside that same row height. The negative vertical margin
// lets the image cover the row padding visually without increasing the row's measured
// height, while the matching calc() size keeps the avatar square after adding that
// top/bottom coverage.
const CHAT_ROW_FULL_HEIGHT_AVATAR_CLASS =
  'my-[-0.125rem] flex h-[calc(1rem+0.25rem)] w-[calc(1rem+0.25rem)] shrink-0 overflow-hidden rounded-none border border-slate-700/80';

function DiscordAvatar({ guildIconUrl, userAvatarUrl, label }) {
  if (!guildIconUrl && !userAvatarUrl) return null;
  return (
    <span
      className={CHAT_ROW_FULL_HEIGHT_AVATAR_CLASS}
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
    <span
      className={CHAT_ROW_FULL_HEIGHT_AVATAR_CLASS}
      title={label}
    >
      <span
        className="h-full w-full bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${imageUrl})` }}
      />
    </span>
  );
}

export function ChatIdentity({ message, toolsToggle = null }) {
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
        <RoverLabel
          roverId={message.roverId}
          color={message.roverColor}
          fallback={message.roverId}
          className="shrink-0 text-[0.7rem]"
        />
      )}
      {toolsToggle}
    </span>
  );
}

function chatRowClass(message) {
  if (isBotMessage(message)) {
    return 'flex flex-col gap-0.5 rounded-md border border-emerald-500/40 bg-emerald-950 px-0.5 py-0.5 text-sm text-neutral-100';
  }
  const isAdmin =
    message.role === 'admin' || message.role === 'lockdown' || message.role === 'lockdown-admin';
  return `flex flex-col gap-0.5 rounded-md bg-neutral-800 px-0.5 py-0.5 text-sm text-neutral-100 ${
    isAdmin
      ? 'border border-amber-400/30'
      : message.fromDiscord
        ? 'border border-indigo-400/30 bg-indigo-950'
        : ''
  }`;
}

export default function ChatMessageRow({ message }) {
  const isBot = isBotMessage(message);
  const role = useSessionSelector((state) => state.session?.role || null);
  const isSpectator = role === 'spectator';
  const [open, setOpen] = useState(false);
  const isOpen = isSpectator || open;
  const toolCalls = Array.isArray(message?.toolCalls) ? message.toolCalls : [];
  const hasText = Boolean(String(message?.text || '').trim());
  const toolsToggle =
    toolCalls.length > 0 ? (
      <button
        type="button"
        className="shrink-0 rounded border border-slate-600/70 bg-slate-800/60 px-1 py-[1px] text-[0.65rem] text-slate-200 hover:bg-slate-700/70"
        onClick={() => {
          if (isSpectator) return;
          setOpen((v) => !v);
        }}
      >
        {isOpen ? '▼' : '▶'} Tools ({toolCalls.length})
      </button>
    ) : null;
  return (
    <div className={chatRowClass(message)}>
      <div className="flex w-full items-start gap-0.5">
        <span
          className={`min-w-0 flex-1 break-words leading-tight whitespace-pre-wrap ${isBot ? 'text-emerald-100' : 'text-slate-100'}`}
        >
          <ChatIdentity message={message} toolsToggle={toolsToggle} />
          {!isOpen && hasText ? ` ${message.text}` : ''}
        </span>
        <span className="shrink-0 text-[0.65rem] text-slate-400/60">
          {formatTime(message.ts)}
        </span>
      </div>
      {isOpen && toolCalls.length > 0 ? (
        <div className="w-full rounded border border-slate-700/70 bg-slate-900/70 p-0.5 text-[0.68rem] text-slate-200">
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
      {isOpen && hasText ? (
        <div className={`w-full break-words leading-tight whitespace-pre-wrap ${isBot ? 'text-emerald-100' : 'text-slate-100'}`}>
          {message.text}
        </div>
      ) : null}
    </div>
  );
}

export { chatRowClass };
