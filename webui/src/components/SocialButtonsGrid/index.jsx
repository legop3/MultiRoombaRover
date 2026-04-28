import { useSession } from '../../context/SessionContext.jsx';
import SocialButton from '../SocialButton/index.jsx';

function normalizeSocials(session) {
  const configured = Array.isArray(session?.socials) ? session.socials : null;
  if (configured && configured.length) {
    return configured;
  }
  const fallback = [];
  if (session?.discord?.invite) {
    fallback.push({ id: 'discord', label: 'Discord', url: session.discord.invite });
  }
  if (session?.kofi?.link) {
    fallback.push({ id: 'kofi', label: 'Ko-fi', url: session.kofi.link });
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
  const { session } = useSession();
  const socials = normalizeSocials(session)
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
