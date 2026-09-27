import { useState } from 'react';
import { useSessionActions } from '../../context/SessionContext.jsx';
import CardFrame from '../../components/CardFrame/index.jsx';
function PtzPresetPanel({ ptz }) {
  const {
    ptzListPresets,
    ptzGotoPreset,
    ptzCreatePreset,
    ptzRemovePreset,
  } = useSessionActions();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const presets = Array.isArray(ptz?.presets) ? ptz.presets : [];
  const isPresetAdmin = Boolean(ptz?.permissions?.canRemovePreset);
  const canCreatePreset = Boolean(ptz?.permissions?.canCreatePreset);
  const canMoveToPreset = Boolean(ptz?.permissions?.canControl);

  const refreshPresets = async () => {
    if (busy) return;
    setBusy('refresh');
    try {
      /*
        Presets live on the camera, not in browser state. A manual refresh gives
        admins a simple recovery path if another admin or the camera's native
        app changes preset storage while this UI is already open.
      */
      await ptzListPresets();
    } catch (err) {
      alert(err.message || 'Failed to refresh PTZ presets.');
    } finally {
      setBusy('');
    }
  };

  const goToPreset = async (preset) => {
    if (!canMoveToPreset || busy || !preset?.token) return;
    setBusy(`goto:${preset.token}`);
    try {
      /*
        Moving to a preset is a physical camera move, so the server still checks
        that this browser owns the active PTZ turn before accepting the command.
      */
      await ptzGotoPreset({ token: preset.token });
    } catch (err) {
      alert(err.message || 'Failed to move to PTZ preset.');
    } finally {
      setBusy('');
    }
  };

  const createPreset = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!canCreatePreset || busy || !trimmed) return;
    setBusy('create');
    try {
      /*
        ONVIF setPreset stores the camera's current physical position. The UI
        only sends the user's label; the server supplies the active profile
        token so browser code does not need camera profile internals, and the
        server still enforces the PTZ feature gate for raw socket callers.
      */
      await ptzCreatePreset({ name: trimmed });
      setName('');
    } catch (err) {
      alert(err.message || 'Failed to create PTZ preset.');
    } finally {
      setBusy('');
    }
  };

  const removePreset = async (preset) => {
    if (!isPresetAdmin || busy || !preset?.token) return;
    const confirmed = window.confirm(`Remove preset "${preset.name}"?`);
    if (!confirmed) return;
    setBusy(`remove:${preset.token}`);
    try {
      /*
        The token is the camera's durable preset identifier. Names are only UI
        labels and may not be unique, so deletion always targets the token.
      */
      await ptzRemovePreset({ token: preset.token });
    } catch (err) {
      alert(err.message || 'Failed to remove PTZ preset.');
    } finally {
      setBusy('');
    }
  };

  return (
    <CardFrame
      title="Position presets"
      fillHeight
      actions={(
        <button type="button" className="button-dark text-xs" disabled={!ptz?.permissions?.canListPresets || Boolean(busy)} onClick={refreshPresets}>
          Refresh
        </button>
      )}
      bodyClassName="flex min-h-0 flex-col gap-1 p-1 text-xs"
    >
      {ptz?.presetsError ? (
        <div className="rounded-sm border border-amber-500/50 bg-amber-950/40 p-1 text-amber-100">
          {ptz.presetsError}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-wrap content-start items-start gap-0.5 overflow-y-auto">
        {/*
          Presets should behave like a compact pile of actions, not a table.
          flex-wrap lets each preset keep its natural button width and only
          starts a new visual line when the current line runs out of room.
        */}
        {presets.length ? presets.map((preset) => {
          const gotoBusy = busy === `goto:${preset.token}`;
          const removeBusy = busy === `remove:${preset.token}`;
          return (
            <div key={preset.token} className="surface inline-flex max-w-full items-center gap-1">
              <button
                type="button"
                className="button-dark min-w-0 max-w-40 truncate text-left text-xs disabled:opacity-50"
                disabled={!canMoveToPreset || Boolean(busy)}
                onClick={() => goToPreset(preset)}
                title={canMoveToPreset ? `Move to ${preset.name}` : 'Your PTZ turn must be active'}
              >
                {gotoBusy ? 'Moving...' : preset.name}
              </button>
              {isPresetAdmin ? (
                <button
                  type="button"
                  className="button-dark text-xs text-rose-200 disabled:opacity-50"
                  disabled={Boolean(busy)}
                  onClick={() => removePreset(preset)}
                >
                  {removeBusy ? 'Removing...' : 'Remove'}
                </button>
              ) : null}
            </div>
          );
        }) : (
          <div className="rounded-sm border border-slate-700 bg-black/30 p-2 text-center text-slate-400">
            No presets saved.
          </div>
        )}
      </div>
      {canCreatePreset ? (
        <form className="grid grid-cols-[minmax(0,1fr)_auto] gap-1" onSubmit={createPreset}>
          <input
            className="field-input min-w-0 text-xs"
            value={name}
            maxLength={60}
            disabled={Boolean(busy)}
            onChange={(event) => setName(event.target.value)}
            placeholder="Preset name"
          />
          <button type="submit" className="button-dark text-xs" disabled={Boolean(busy) || !name.trim()}>
            {busy === 'create' ? 'Saving...' : 'Save'}
          </button>
        </form>
      ) : null}
    </CardFrame>
  );
}

export { PtzPresetPanel };
