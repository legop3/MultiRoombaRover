import { useMemo } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { roverNameChromeStyle } from '../../lib/roverColor.js';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function resolveText({ rover, name, fallback, roverId, rosterEntry }) {
  const candidates = [
    name,
    rover?.name,
    rosterEntry?.name,
    fallback,
    roverId,
    rover?.id,
    rosterEntry?.id,
    'No rover',
  ];
  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (text) return text;
  }
  return 'No rover';
}

export default function RoverLabel({
  rover = null,
  roverId = null,
  name = null,
  color = null,
  fallback = null,
  className = '',
  as: Component = 'span',
  style = undefined,
  ...props
}) {
  const resolvedRoverId = roverId ?? rover?.id ?? null;
  const rosterEntry = useSessionSelector((state) => {
    if (!resolvedRoverId) return null;
    const roster = Array.isArray(state.session?.roster) ? state.session.roster : [];
    return roster.find((entry) => String(entry?.id) === String(resolvedRoverId)) || null;
  });
  const resolvedColor = color ?? rover?.color ?? rosterEntry?.color ?? null;
  const label = useMemo(
    () => resolveText({ rover, name, fallback, roverId: resolvedRoverId, rosterEntry }),
    [fallback, name, resolvedRoverId, rosterEntry, rover],
  );

  return (
    <Component
      className={classNames(
        'inline-block rounded border border-transparent px-1 py-[1px] font-semibold text-white',
        className,
      )}
      style={{ ...(style || {}), ...(roverNameChromeStyle(resolvedColor, 0.26) || {}) }}
      {...props}
    >
      {label}
    </Component>
  );
}
