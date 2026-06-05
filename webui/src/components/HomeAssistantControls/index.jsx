// Home Assistant Controls
// Purpose: Defines the Home Assistant Controls module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useControlSystem } from '../../controls/index.js';
import { formatKeyLabel } from '../../controls/keymapUtils.js';
import CardFrame from '../CardFrame/index.jsx';

const COLOR_SWATCHES = Object.freeze([
  { id: 'white', label: 'White', hex: '#ffffff', action: 'white' },
  { id: 'red', label: 'Red', hex: '#ff0000' },
  { id: 'green', label: 'Green', hex: '#00ff00' },
  { id: 'cyan', label: 'Cyan', hex: '#00c7be' },
  { id: 'blue', label: 'Blue', hex: '#0000ff' },
  { id: 'purple', label: 'Purple', hex: '#bf5af2' },
]);

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

function cx(...values) {
  return values.filter(Boolean).join(' ');
}

function buildTileStyle(entity, { unavailable, isOn, supportsColor }) {
  if (unavailable) return undefined;
  if (!isOn) return undefined;
  const colorHex = supportsColor ? entity.colorHex : null;
  if (!colorHex) return undefined;

  // The server owns Home Assistant color-format conversion and exposes a CSS
  // hex string. React only uses it as a display value here, which keeps browser
  // rendering decoupled from HA-specific rgb/hs attribute shapes.
  return {
    backgroundColor: colorHex,
    borderColor: 'rgba(255,255,255,0.38)',
  };
}

function LampSwatch({ entity, swatch, disabled, onSetColor, onSetWhite }) {
  const handleClick = (event) => {
    // Swatches live inside a tile that toggles the lamp when clicked. Stop the
    // event here so choosing a color is a single, unambiguous action instead of
    // setting color and then also toggling the lamp off.
    event.stopPropagation();
    if (disabled) return;

    // White gets its own server action because Home Assistant white/temperature
    // mode is not the same as sending pure RGB white on many smart bulbs.
    if (swatch.action === 'white') {
      onSetWhite(entity.id).catch(() => {});
      return;
    }
    onSetColor(entity.id, swatch.hex).catch(() => {});
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={(event) => {
        // Keyboard activation on a swatch should follow the same isolation rule
        // as pointer clicks: the swatch owns color selection, the tile owns
        // lamp toggling.
        event.stopPropagation();
      }}
      disabled={disabled}
      title={`${swatch.label} ${entity.name || entity.id}`}
      aria-label={`Set ${entity.name || entity.id} to ${swatch.label}`}
      className={cx(
        // The tile background already shows the Home Assistant-reported color,
        // so swatches are plain presets rather than a selected-state indicator.
        'h-5 w-6 shrink-0 rounded-sm border border-white/80 transition-transform disabled:cursor-not-allowed disabled:opacity-40',
        !disabled && 'hover:scale-110 hover:border-white',
      )}
      style={{ backgroundColor: swatch.hex }}
    />
  );
}

function LampTile({ entity, connected, controlsLocked, onToggle, onSetColor, onSetWhite }) {
  const unavailable = entity.state === 'unavailable' || !entity.available;
  const isOn = entity.state === 'on';
  const supportsColor = entity.type === 'light' && entity.supportsColor;
  const statusTone = unavailable ? 'warn' : isOn ? 'success' : 'muted';
  const statusLabel = unavailable ? 'Unavailable' : isOn ? 'On' : 'Off';
  const disableToggle = controlsLocked || !connected || unavailable;
  const disableColor = disableToggle || !supportsColor;
  const tileStyle = buildTileStyle(entity, { unavailable, isOn, supportsColor });
  const tileTone = unavailable
    ? 'border-slate-800 bg-slate-950 text-slate-500'
    : controlsLocked
    ? 'border-amber-700/60 bg-amber-950/70 text-amber-100'
    : isOn
    ? 'border-emerald-700/70 bg-emerald-900 text-white'
    : 'border-neutral-700 bg-neutral-950 text-slate-300';

  const handleTileToggle = () => {
    if (disableToggle) return;
    onToggle(entity.id);
  };

  const handleTileKeyDown = (event) => {
    // The outer element is intentionally the interactive tile because HTML
    // cannot validly nest the color swatch buttons inside another button. Giving
    // the tile button-like keyboard behavior keeps the larger click target
    // accessible while preserving real buttons for swatches.
    if (disableToggle) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleTileToggle();
  };

  return (
    <div
      role="button"
      tabIndex={disableToggle ? -1 : 0}
      onClick={handleTileToggle}
      onKeyDown={handleTileKeyDown}
      aria-disabled={disableToggle}
      className={cx(
        // The parent grid owns row and column sizing so the room-controls panel
        // never sprawls wider than three lamps per row. The tile only keeps a
        // small minimum width so names and swatches remain readable.
        'flex min-w-[9.5rem] flex-col gap-0.5 rounded border px-0.5 py-0.5 transition-colors',
        disableToggle ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-white/60',
        tileTone,
      )}
      style={tileStyle}
      title={`${isOn ? 'Turn off' : 'Turn on'} ${entity.name || entity.id}`}
    >
      <div className="-mx-0.5 -mt-0.5 grid min-h-5 grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5 rounded-t bg-black/45 px-0.5 py-0.5 text-left text-white">
        <span className="min-w-0 truncate text-[0.78rem] font-semibold leading-none">
          {entity.name || entity.id}
        </span>
        <span className="flex items-center gap-0.5">
          <StatusBadge label={statusLabel} tone={statusTone} />
          {!connected ? <span className="text-[0.65rem] font-semibold text-amber-200">Offline</span> : null}
        </span>
      </div>
      {supportsColor ? (
        <div className="flex flex-wrap justify-center gap-0.5">
          {COLOR_SWATCHES.map((swatch) => (
            <LampSwatch
              key={swatch.id}
              entity={entity}
              swatch={swatch}
              disabled={disableColor}
              onSetColor={onSetColor}
              onSetWhite={onSetWhite}
            />
          ))}
        </div>
      ) : null}
    </div>
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
      <CardFrame title="Room Controls" bodyClassName="space-y-0.5 text-sm text-slate-400">
        <p className="text-slate-500">Not configured on the server.</p>
      </CardFrame>
    );
  }

  if (entities.length === 0) {
    return (
      <CardFrame title="Room Controls" bodyClassName="space-y-0.5 text-sm text-slate-400">
        <p className="text-slate-500">No lights or switches configured.</p>
      </CardFrame>
    );
  }

  const connected = Boolean(ha?.connected);

  const actions = (
    <>
      <div className="flex items-center gap-0.5 text-[0.68rem] text-slate-400">
        <span className="flex items-center gap-0.5">
          <span>On</span>
          {onKeyLabel ? <KeyPill label={onKeyLabel} /> : null}
        </span>
        <span className="flex items-center gap-0.5">
          <span>Off</span>
          {offKeyLabel ? <KeyPill label={offKeyLabel} /> : null}
        </span>
      </div>
      {controlsLocked ? <StatusBadge label={lockState === 'off' ? 'Locked Off' : 'Locked On'} tone="warn" /> : null}
      <StatusBadge label={connected ? 'Connected' : 'Offline'} tone={connected ? 'success' : 'warn'} />
    </>
  );

  return (
    <CardFrame title="Room Controls" actions={actions} bodyClassName="space-y-0.5 text-base">
      {controlsLocked ? (
        <p className="rounded border border-amber-600/60 bg-amber-900/40 px-1 py-0.5 text-xs text-amber-100">
          {lockState === 'off'
            ? 'Lights are locked off. Room controls are disabled.'
            : 'Lights are locked on. Room controls are disabled.'}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
        {entities.map((entity) => (
          <LampTile
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
    </CardFrame>
  );
}

function KeyPill({ label }) {
  if (!label) return null;
  return <span className="rounded border border-slate-600 px-1 text-[0.65rem] text-slate-300">{label}</span>;
}
