// Home Assistant Controls
// Purpose: Defines the Home Assistant Controls module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useControlSystem } from '../../controls/index.js';
import { formatKeyLabel } from '../../controls/keymapUtils.js';

function StatusBadge({ label, tone = 'muted' }) {
  const styles =
    tone === 'success'
      ? 'bg-emerald-900 text-emerald-100'
      : tone === 'warn'
      ? 'bg-amber-900 text-amber-100'
      : 'bg-slate-800 text-slate-200';
  return (
    <span className={`rounded px-1 py-0.5 text-xs font-semibold leading-none ${styles}`}>
      {label}
    </span>
  );
}

function clampHue(value) {
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function rgbToHue(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return 0;
  const [rRaw, gRaw, bRaw] = rgb;
  const r = Math.max(0, Math.min(255, Number(rRaw))) / 255;
  const g = Math.max(0, Math.min(255, Number(gRaw))) / 255;
  const b = Math.max(0, Math.min(255, Number(bRaw))) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue = 0;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  return clampHue(Math.round(hue * 60));
}

function hueToRgb(hue) {
  const h = clampHue(hue);
  const c = 1;
  const x = 1 - Math.abs(((h / 60) % 2) - 1);
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function getEntityHue(entity) {
  if (!entity) return 0;
  if (Array.isArray(entity.hsColor)) {
    return clampHue(Number(entity.hsColor[0]));
  }
  if (Array.isArray(entity.rgbColor)) {
    return rgbToHue(entity.rgbColor);
  }
  return 0;
}

function EntityRow({ entity, connected, controlsLocked, onToggle, onSetColor, onSetWhite }) {
  const unavailable = entity.state === 'unavailable' || !entity.available;
  const isOn = entity.state === 'on';
  const supportsColor = entity.type === 'light' && entity.supportsColor;
  const statusTone = unavailable ? 'warn' : isOn ? 'success' : 'muted';
  const statusLabel = unavailable ? 'Unavailable' : isOn ? 'On' : 'Off';
  const disableToggle = controlsLocked || !connected || unavailable;
  const disableColor = disableToggle || !supportsColor;
  const [hue, setHue] = useState(() => getEntityHue(entity));
  const hueRef = useRef(hue);
  const draggingRef = useRef(false);
  const toneStyles = unavailable
    ? 'border-slate-800 bg-slate-900 text-slate-400 cursor-not-allowed'
    : controlsLocked
    ? 'border-slate-800 bg-slate-900 text-slate-300 cursor-not-allowed'
    : isOn
    ? 'border-emerald-700 bg-emerald-900/80 text-emerald-50 hover:bg-emerald-800'
    : 'border-rose-800 bg-rose-900/80 text-rose-50 hover:bg-rose-800';

  useEffect(() => {
    if (!supportsColor || draggingRef.current) return;
    const nextHue = getEntityHue(entity);
    hueRef.current = nextHue;
    setHue(nextHue);
  }, [entity.rgbColor, entity.hsColor, supportsColor]);

  const handleHueChange = (event) => {
    const nextHue = clampHue(Number(event.target.value));
    hueRef.current = nextHue;
    setHue(nextHue);
  };

  const commitHue = () => {
    if (disableColor || !onSetColor) return;
    onSetColor(entity.id, hueToRgb(hueRef.current));
  };

  const stopPropagation = (event) => {
    event.stopPropagation();
  };

  const handleSetWhite = (event) => {
    stopPropagation(event);
    if (disableColor || !onSetWhite) return;
    onSetWhite(entity.id);
  };

  const displayRgb = supportsColor ? hueToRgb(hueRef.current) : [255, 255, 255];
  const displayColor = `rgb(${displayRgb.join(',')})`;

  return (
    <button
      type="button"
      onClick={() => onToggle(entity.id)}
      disabled={disableToggle}
      className={`relative flex min-w-[12rem] flex-[1_1_12rem] items-start justify-between gap-0.5 rounded px-1 py-0.5 text-left transition-colors ${toneStyles} disabled:opacity-60 disabled:hover:bg-inherit`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-0.5 text-sm leading-normal">
          <span className="truncate font-semibold text-white">{entity.name || entity.id}</span>
          {supportsColor && (
            <>
              <StatusBadge label={statusLabel} tone={statusTone} />
              {!connected && <span className="text-xs text-amber-200">Offline</span>}
            </>
          )}
        </div>
        {supportsColor ? (
          <div
            className="-mt-0.5 w-full"
            onClick={stopPropagation}
            onPointerDown={(event) => {
              stopPropagation(event);
              draggingRef.current = true;
            }}
            onPointerUp={(event) => {
              stopPropagation(event);
              draggingRef.current = false;
              commitHue();
            }}
            onPointerCancel={(event) => {
              stopPropagation(event);
              draggingRef.current = false;
              commitHue();
            }}
            onKeyUp={(event) => {
              stopPropagation(event);
              commitHue();
            }}
            onBlur={commitHue}
          >
            <div className="relative w-full">
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={hue}
                onChange={handleHueChange}
                disabled={disableColor}
                aria-label={`Set color for ${entity.name || entity.id}`}
                className="ha-hue-slider w-full"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-0.5 text-xs text-slate-400">
            <StatusBadge label={statusLabel} tone={statusTone} />
            {!connected && <span className="text-amber-200"> · Offline</span>}
          </div>
        )}
      </div>
      {supportsColor && (
        <div className="absolute right-1 top-1 flex items-center gap-0.5">
          <span
            role="button"
            tabIndex={disableColor ? -1 : 0}
            onClick={handleSetWhite}
            onPointerDown={stopPropagation}
            onKeyDown={(event) => {
              if (disableColor) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleSetWhite(event);
              }
            }}
            title="Set white color temperature"
            aria-label={`Set ${entity.name || entity.id} to white`}
            aria-disabled={disableColor}
            className={`inline-flex items-center justify-center rounded border border-slate-200 bg-white px-1 py-0.5 text-xs font-semibold leading-none text-slate-900 ${
              disableColor
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:bg-slate-100'
            }`}
          >
            white
          </span>
          <span
            className="pointer-events-none h-2.5 w-2.5 rounded-full border border-white/60"
            style={{ backgroundColor: displayColor }}
          />
        </div>
      )}
      {!supportsColor && (
        <div className="self-center text-xs font-semibold text-white/90">
          {isOn ? 'Turn off' : 'Turn on'}
        </div>
      )}
    </button>
  );
}

export default function HomeAssistantControls() {
  const {
    state: { keymap },
  } = useControlSystem();
  const ha = useSessionSelector((state) => state.session?.homeAssistant || null);
  const { homeAssistantToggle, homeAssistantSetLightColor, homeAssistantSetLightWhite } =
    useSessionActions();
  const entities = useMemo(() => ha?.entities || [], [ha?.entities]);
  const lightPolicy = ha?.lightPolicy || null;
  const controlsLocked = Boolean(lightPolicy?.locked || lightPolicy?.lockedOn);
  const lockState = lightPolicy?.lockState || (lightPolicy?.lockedOn ? 'on' : null);
  const onKeyLabel = formatKeyLabel(keymap?.homeAssistantOn?.[0]);
  const offKeyLabel = formatKeyLabel(keymap?.homeAssistantOff?.[0]);

  if (!ha?.enabled) {
    return (
      <section className="panel-section space-y-0.5 text-sm text-slate-400">
        <p className="panel-title-text">Room Controls</p>
        <p className="text-slate-500">Not configured on the server.</p>
      </section>
    );
  }

  if (entities.length === 0) {
    return (
      <section className="panel-section space-y-0.5 text-sm text-slate-400">
        <p className="panel-title-text">Room Controls</p>
        <p className="text-slate-500">No lights or switches configured.</p>
      </section>
    );
  }

  const connected = Boolean(ha?.connected);

  return (
    <section className="panel-section space-y-0.5 text-base">
      <header className="panel-title-row">
        <div className="panel-title-left">
          <p className="panel-title-text">Room Controls</p>
          <span className="panel-title-meta">{entities.length}</span>
        </div>
        <div className="panel-title-right">
          <div className="panel-title-actions">
            <span className="flex items-center gap-0.5">
              <span className="panel-title-meta">On</span>
              {onKeyLabel ? <KeyPill label={onKeyLabel} /> : null}
            </span>
            <span className="flex items-center gap-0.5">
              <span className="panel-title-meta">Off</span>
              {offKeyLabel ? <KeyPill label={offKeyLabel} /> : null}
            </span>
          </div>
          {controlsLocked ? <StatusBadge label={lockState === 'off' ? 'Locked Off' : 'Locked On'} tone="warn" /> : null}
          <StatusBadge label={connected ? 'Connected' : 'Offline'} tone={connected ? 'success' : 'warn'} />
        </div>
      </header>
      {controlsLocked ? (
        <p className="rounded border border-amber-600/60 bg-amber-900/40 px-1 py-0.5 text-xs text-amber-100">
          {lockState === 'off'
            ? 'Lights are locked off. Room controls are disabled.'
            : 'Lights are locked on. Room controls are disabled.'}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-0.5">
        {entities.map((entity) => (
          <EntityRow
            key={entity.id}
            entity={entity}
            connected={connected}
            controlsLocked={controlsLocked}
            onToggle={homeAssistantToggle}
            onSetColor={homeAssistantSetLightColor}
            onSetWhite={homeAssistantSetLightWhite}
          />
        ))}
      </div>
    </section>
  );
}

function KeyPill({ label }) {
  if (!label) return null;
  return <span className="rounded border border-slate-600 px-1 text-[0.65rem] text-slate-300">{label}</span>;
}
