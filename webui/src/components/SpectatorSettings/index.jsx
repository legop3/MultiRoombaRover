// Spectator Settings
// Purpose: Provides a shared gear menu for page-defined spectator options.
// Scope: Pages supply their options and own preference persistence.
import { useEffect, useRef, useState } from 'react';
import { FaCog } from 'react-icons/fa';
import CardFrame from '../CardFrame/index.jsx';

export default function SpectatorSettings({ options, preferences, onToggle }) {
  const [open, setOpen] = useState(false);
  const controlsRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      /*
        The popup floats above both the sidebar and camera grid, so clicking
        elsewhere should dismiss it without changing any saved preference.
        Keeping the gear and popup under one ref makes clicks on either safe.
      */
      if (!controlsRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      // Escape mirrors normal dialog/menu behavior without trapping keyboard focus.
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={controlsRef} className="fixed right-1 top-1 z-50 flex flex-col items-end gap-0.5">
      <button
        type="button"
        className="button-dark flex h-8 w-8 items-center justify-center p-0 text-slate-100 shadow-lg"
        aria-label="Spectator settings"
        aria-expanded={open}
        aria-controls="spectator-view-controls"
        onClick={() => setOpen((current) => !current)}
      >
        <FaCog aria-hidden="true" />
      </button>
      {open ? (
        <CardFrame
          title="Settings"
          className="w-48 shadow-xl"
          bodyClassName="space-y-0.5 p-0.5 text-sm"
          clipOverflow={false}
        >
          <div id="spectator-view-controls" className="space-y-0.5">
            {options.map((option) => (
              <label
                key={option.key}
                className="surface-muted flex cursor-pointer items-center gap-0.5 px-1 py-0.75 text-slate-100"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-sky-500"
                  checked={preferences[option.key] !== false}
                  onChange={(event) => onToggle(option.key, event.target.checked)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </CardFrame>
      ) : null}
    </div>
  );
}
