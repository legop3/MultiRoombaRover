// Social Button
// Purpose: Defines the Social Button module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import * as FaIcons from 'react-icons/fa';
import { FaLink } from 'react-icons/fa';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { getSocialById } from '../../lib/socials.js';

function sanitizeCssColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^(rgb|rgba|hsl|hsla)\([^)]+\)$/.test(trimmed)) return trimmed;
  return null;
}

function resolveIcon(iconName) {
  if (typeof iconName !== 'string' || !iconName.trim()) return FaLink;
  const icon = FaIcons[iconName.trim()];
  return typeof icon === 'function' ? icon : FaLink;
}

export default function SocialButton({ id = null, label, url, icon, color, layout = 'stacked', className = '' }) {
  const socialFromId = useSessionSelector((state) => (id ? getSocialById(state, id) : null));
  const resolvedUrl = url || socialFromId?.url || null;
  if (!resolvedUrl) return null;
  const resolvedIcon = icon || socialFromId?.icon || null;
  const resolvedColor = color || socialFromId?.color || null;
  const Icon = resolveIcon(resolvedIcon);
  const bgColor = sanitizeCssColor(resolvedColor);
  const text = label || socialFromId?.label || 'Link';
  const isInline = layout === 'inline';

  return (
    <a
      href={resolvedUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={text}
      className={`grid h-full min-h-0 w-full place-items-center rounded-md bg-slate-700 px-0.5 ${isInline ? 'py-0.5' : 'pb-3'} text-center text-sm font-medium text-white transition hover:opacity-90 ${className}`}
      style={bgColor ? { backgroundColor: bgColor } : undefined}
    >
      {isInline ? (
        <span className="inline-flex max-w-full items-center justify-center gap-1 text-center leading-tight">
          <Icon className="shrink-0" style={{ fontSize: '1.1em' }} />
          <span className="break-words">{text}</span>
        </span>
      ) : (
        <span className="flex h-full w-full max-w-full flex-col items-center justify-between text-center leading-tight">
          <span className="flex min-h-0 flex-1 items-center justify-center">
            <Icon className="shrink-0" style={{ fontSize: 'clamp(1rem, 2.2vh + 1.2vw, 2rem)' }} />
            {/* <Icon className="shrink-0" style={{ fontSize: '2vh' }} /> */}
          </span>
          <span className="w-full break-words leading-tight">{text}</span>
        </span>
      )}
    </a>
  );
}
