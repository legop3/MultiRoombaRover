// Social Buttons Grid
// Purpose: Defines the Social Buttons Grid module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useSessionSelector } from '../../context/SessionContext.jsx';
import SocialButton from '../SocialButton/index.jsx';

export default function SocialButtonsGrid({ className = '' }) {
  const socials = useSessionSelector((state) => state.session?.socials ?? []).slice(0, 4);

  if (!socials.length) return null;

  return (
    <div className={`grid grid-cols-2 grid-rows-2 gap-0.5 ${className}`}>
      {socials.map((entry) => (
        <SocialButton
          key={`${entry?.id || entry?.label || 'social'}-${entry?.url || ''}`}
          id={entry?.id || entry?.key || entry?.service || null}
        />
      ))}
    </div>
  );
}
