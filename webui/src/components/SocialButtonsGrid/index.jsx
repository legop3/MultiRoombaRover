// Social Buttons Grid
// Purpose: Defines the Social Buttons Grid module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useSessionSelector } from '../../context/SessionContext.jsx';
import SocialButton from '../SocialButton/index.jsx';

function normalizeSocials({ socials, discordInvite, kofiLink }) {
  const configured = Array.isArray(socials) ? socials : null;
  if (configured && configured.length) {
    return configured;
  }
  const fallback = [];
  if (discordInvite) {
    fallback.push({ id: 'discord', label: 'Discord', url: discordInvite });
  }
  if (kofiLink) {
    fallback.push({ id: 'kofi', label: 'Ko-fi', url: kofiLink });
  }
  return fallback;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = entry.id || entry.service || entry.key || entry.name || null;
  const label = entry.label || entry.title || entry.name || id || 'Link';
  const url = entry.url || entry.link || entry.href || null;
  return url ? { id, label, url } : null;
}

export default function SocialButtonsGrid({ className = '' }) {
  const socialsInput = useSessionSelector((state) => ({
    socials: state.session?.socials ?? [],
    discordInvite: state.session?.discord?.invite || null,
    kofiLink: state.session?.kofi?.link || null,
  }));
  const socials = normalizeSocials(socialsInput)
    .map(normalizeEntry)
    .filter(Boolean)
    .slice(0, 4);

  if (!socials.length) return null;

  return (
    <div className={`grid grid-cols-2 grid-rows-2 gap-0.5 ${className}`}>
      {socials.map((entry) => (
        <SocialButton key={`${entry.id || entry.label}-${entry.url}`} {...entry} />
      ))}
    </div>
  );
}
