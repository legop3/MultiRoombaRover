// Gamepad Mapping Settings Content
// Purpose: Defines the Gamepad Mapping Settings Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsNamespace } from '../../settings/index.js';
import { GAMEPAD_PROFILE_DEFAULT, GAMEPAD_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import {
  computeGamepadOutputs,
  createProfileForPad,
  resolveGamepadProfile,
} from '../../controls/inputs/gamepadBindings.js';
import { useGamepadHubState } from '../../controls/inputs/gamepadHub.js';
import { acquireControllerControlLock } from '../../controls/inputs/controllerRuntime.js';
import { describeController, formatControllerBinding } from '../../controls/inputs/controllerLabels.js';
import CardFrame from '../CardFrame/index.jsx';
import SliderField from './SliderField.jsx';
import { ACTIONS, NUMBER_FORMAT } from './constants.js';
import {
  groupActions,
  pickActivePad,
  snapshotBaseline,
  buildDescriptorFromCapture,
} from './helpers.js';

function SettingsGroupLabel({ children }) {
  // Section labels stay visually modest so this panel matches the rest of the app, while white
  // text keeps them readable without uppercase or oversized type.
  return <p className="mx-auto w-full max-w-lg text-sm font-semibold text-white">{children}</p>;
}

function CurveField({ label, value, onChange }) {
  return (
    <label className="mx-auto block w-full max-w-lg rounded bg-neutral-800/80 px-1.5 py-1">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 text-sm text-white">
        <span className="font-semibold">{label}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-sm text-white"
        >
          <option value="linear">Linear</option>
          <option value="expo">Fine center control</option>
        </select>
      </div>
    </label>
  );
}

function MappingRow({
  action,
  source,
  sourceLabel,
  liveValue,
  isCapturing,
  onClear,
  onCapture,
  onInvert,
  disabled,
}) {
  // Mapping rows are constrained to a readable width so the source text and buttons remain
  // visually connected. Buttons wrap on very narrow panes instead of forcing tiny text.
  return (
    <div className="mx-auto grid w-full max-w-lg grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded bg-neutral-800/80 px-1.5 py-1 text-sm max-[520px]:grid-cols-1">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <p className="font-semibold leading-snug text-white">{action.label}</p>
          <span className={`h-1.5 w-1.5 rounded-full ${liveValue ? 'bg-emerald-400' : 'bg-neutral-600'}`} aria-hidden="true" />
        </div>
        <p className="mt-0.5 text-xs leading-snug text-white">{sourceLabel}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1 max-[520px]:justify-start">
        {/* Axis-pair controls expose independent inversion because stick X/Y directions often
            differ between browser mappings. Keeping those buttons beside the source avoids
            making users hunt across a wide row while testing a binding. */}
        {action.kind === 'axisPair' && (
          <>
            <button
              type="button"
              disabled={disabled || !source}
              onClick={() => onInvert(action, 'invertX')}
              className="button-dark px-1 py-0.5 text-xs font-medium disabled:opacity-50"
            >
              Invert X
            </button>
            <button
              type="button"
              disabled={disabled || !source}
              onClick={() => onInvert(action, 'invertY')}
              className="button-dark px-1 py-0.5 text-xs font-medium disabled:opacity-50"
            >
              Invert Y
            </button>
          </>
        )}
        {/* Single-axis mappings only have one inversion flag, so they render the smaller control
            set and keep button clutter down for trigger-like bindings. */}
        {action.kind === 'axis' && (
          <button
            type="button"
            disabled={disabled || !source}
            onClick={() => onInvert(action)}
            className="button-dark px-1 py-0.5 text-xs font-medium disabled:opacity-50"
          >
            Invert
          </button>
        )}
        {/* Clear and Capture are always present because they are the primary row actions. They
            wrap with the inversion controls on narrow panes instead of shrinking text. */}
        <button type="button" disabled={disabled} onClick={() => onClear(action)} className="button-dark px-1 py-0.5 text-xs disabled:opacity-50">
          Clear
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCapture(action)}
          className={`${
            isCapturing
              ? 'rounded-md bg-emerald-500 px-1 py-0.5 text-emerald-950 hover:bg-emerald-400'
              : 'button-dark px-1 py-0.5'
          } text-xs font-medium disabled:opacity-50`}
        >
          {isCapturing ? 'Waiting...' : 'Capture'}
        </button>
      </div>
    </div>
  );
}

export default function GamepadMappingSettings() {
  const hubState = useGamepadHubState();
  const { value: gamepadSettings, save: saveGamepadSettings } = useSettingsNamespace(
    'gamepad',
    GAMEPAD_SETTINGS_DEFAULTS,
  );
  const [captureAction, setCaptureAction] = useState(null);
  const [actionFilter, setActionFilter] = useState('');
  const baselineRef = useRef(null);
  const captureCandidateRef = useRef(null);
  const grouped = useMemo(() => {
    const query = actionFilter.trim().toLowerCase();
    const visibleActions = query
      ? ACTIONS.filter((action) => `${action.label} ${action.section}`.toLowerCase().includes(query))
      : ACTIONS;
    return groupActions(visibleActions);
  }, [actionFilter]);

  useEffect(() => {
    /* The Controller tab is a diagnostic surface. Locking for its entire mounted lifetime makes
       calibration and casual input testing safe, not only the brief moment a binding is captured. */
    return acquireControllerControlLock('controller-settings');
  }, []);

  const activePad = useMemo(
    () => pickActivePad(hubState.pads, gamepadSettings.activeInstanceKey),
    [hubState.pads, gamepadSettings.activeInstanceKey],
  );

  const activeSignature = activePad?.signature ?? null;
  const activeProfile = useMemo(() => {
    const storedProfile = !activeSignature
      ? gamepadSettings?.defaults?.profile ?? GAMEPAD_PROFILE_DEFAULT
      : (
      gamepadSettings?.profiles?.[activeSignature] ??
      gamepadSettings?.defaults?.profile ??
      GAMEPAD_PROFILE_DEFAULT
      );
    return resolveGamepadProfile(storedProfile, GAMEPAD_PROFILE_DEFAULT);
  }, [activeSignature, gamepadSettings?.defaults?.profile, gamepadSettings?.profiles]);

  useEffect(() => {
    if (!activePad || !activeSignature) return;
    if (gamepadSettings?.profiles?.[activeSignature]) return;
    saveGamepadSettings((prev) => {
      const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
      if (current.profiles?.[activeSignature]) return current;
      const base = resolveGamepadProfile(current?.defaults?.profile, GAMEPAD_PROFILE_DEFAULT);
      const nextProfile = createProfileForPad(activePad, base);
      return {
        ...current,
        profiles: {
          ...(current.profiles ?? {}),
          [activeSignature]: nextProfile,
        },
      };
    });
  }, [activePad, activeSignature, gamepadSettings?.profiles, saveGamepadSettings]);

  useEffect(() => {
    baselineRef.current = null;
    captureCandidateRef.current = null;
  }, [captureAction, activeSignature]);

  useEffect(() => {
    if (!captureAction || !activePad) return;
    if (!baselineRef.current) {
      baselineRef.current = snapshotBaseline(activePad);
      return;
    }
    let descriptor = buildDescriptorFromCapture(activePad, baselineRef.current, captureAction);
    if (captureAction.kind === 'button' && descriptor?.kind !== 'chord') {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (descriptor && !captureCandidateRef.current) {
        /* Give the user a short window to add a modifier after the first button. Immediate capture
           makes chords physically impossible because browser frames never report both presses at
           precisely the same instant. */
        captureCandidateRef.current = { descriptor, startedAt: now };
        return;
      }
      if (!captureCandidateRef.current) return;
      if (now - captureCandidateRef.current.startedAt < 220) return;
      /* A quick tap may already be released when the chord window expires. Preserve the original
         candidate so capture completes normally instead of waiting for an unrelated later press. */
      descriptor = captureCandidateRef.current.descriptor;
    }
    if (!descriptor) return;
    saveGamepadSettings((prev) => {
      const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
      const baseProfile = resolveGamepadProfile(
        current.profiles?.[activeSignature] ?? current?.defaults?.profile,
        GAMEPAD_PROFILE_DEFAULT,
      );
      const descriptorKey = JSON.stringify(descriptor);
      const bindingsWithoutConflict = Object.fromEntries(
        Object.entries(baseProfile.bindings ?? {}).map(([actionId, binding]) => {
          if (actionId === captureAction.id) return [actionId, binding];
          const sources = (binding?.sources ?? []).filter(
            (source) => JSON.stringify(source) !== descriptorKey,
          );
          return [actionId, { ...binding, sources }];
        }),
      );
      const nextProfile = {
        ...baseProfile,
        bindings: {
          /* A physical input has one owner by default. Removing an exact duplicate avoids two
             toggles firing from one press while still allowing deliberate multi-button chords. */
          ...bindingsWithoutConflict,
          [captureAction.id]: {
            ...(baseProfile.bindings?.[captureAction.id] ?? {}),
            kind: captureAction.kind,
            sources: [descriptor],
          },
        },
      };
      return {
        ...current,
        profiles: {
          ...(current.profiles ?? {}),
          [activeSignature]: nextProfile,
        },
      };
    });
    /* Hub snapshots drive this effect, but capture state is React-owned UI state. Deferring its
       reset to a microtask avoids a synchronous state cascade inside the effect while the id
       guard prevents an older completion from cancelling a newer capture request. */
    const completedActionId = captureAction.id;
    queueMicrotask(() => {
      setCaptureAction((current) => current?.id === completedActionId ? null : current);
    });
  }, [activePad, activeSignature, captureAction, saveGamepadSettings]);

  const setActiveInstanceKey = useCallback(
    (instanceKey) => {
      saveGamepadSettings((prev) => ({
        ...(prev ?? GAMEPAD_SETTINGS_DEFAULTS),
        activeInstanceKey: instanceKey || null,
      }));
    },
    [saveGamepadSettings],
  );

  const updateCalibration = useCallback(
    (patch) => {
      saveGamepadSettings((prev) => {
        const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
        const storedProfile =
          (activeSignature && current.profiles?.[activeSignature]) ??
          current?.defaults?.profile;
        const baseProfile = resolveGamepadProfile(storedProfile, GAMEPAD_PROFILE_DEFAULT);
        const nextProfile = {
          ...baseProfile,
          calibration: {
            ...(baseProfile.calibration ?? {}),
            ...patch,
          },
        };
        if (!activeSignature) {
          return {
            ...current,
            defaults: {
              ...(current.defaults ?? {}),
              profile: nextProfile,
            },
          };
        }
        return {
          ...current,
          profiles: {
            ...(current.profiles ?? {}),
            [activeSignature]: nextProfile,
          },
        };
      });
    },
    [activeSignature, saveGamepadSettings],
  );

  const updateProfile = useCallback(
    (patch) => {
      saveGamepadSettings((prev) => {
        const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
        const storedProfile =
          (activeSignature && current.profiles?.[activeSignature]) ??
          current?.defaults?.profile;
        const nextProfile = {
          ...resolveGamepadProfile(storedProfile, GAMEPAD_PROFILE_DEFAULT),
          ...patch,
        };
        if (!activeSignature) {
          return {
            ...current,
            defaults: { ...(current.defaults ?? {}), profile: nextProfile },
          };
        }
        return {
          ...current,
          profiles: { ...(current.profiles ?? {}), [activeSignature]: nextProfile },
        };
      });
    },
    [activeSignature, saveGamepadSettings],
  );

  const resetActiveProfile = useCallback(() => {
    /* Resetting only the selected hardware avoids erasing carefully tuned profiles for other
       controllers. Device metadata is rebuilt so the profile remains recognizable offline. */
    const nextProfile = createProfileForPad(activePad, GAMEPAD_PROFILE_DEFAULT);
    updateProfile(nextProfile);
    setCaptureAction(null);
  }, [activePad, updateProfile]);

  const updateBinding = useCallback(
    (actionId, updater) => {
      saveGamepadSettings((prev) => {
        const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
        const storedProfile =
          (activeSignature && current.profiles?.[activeSignature]) ??
          current?.defaults?.profile;
        const baseProfile = resolveGamepadProfile(storedProfile, GAMEPAD_PROFILE_DEFAULT);
        const nextBinding = updater(baseProfile.bindings?.[actionId] ?? {});
        const nextProfile = {
          ...baseProfile,
          bindings: {
            ...(baseProfile.bindings ?? {}),
            [actionId]: nextBinding,
          },
        };
        if (!activeSignature) {
          return {
            ...current,
            defaults: {
              ...(current.defaults ?? {}),
              profile: nextProfile,
            },
          };
        }
        return {
          ...current,
          profiles: {
            ...(current.profiles ?? {}),
            [activeSignature]: nextProfile,
          },
        };
      });
    },
    [activeSignature, saveGamepadSettings],
  );

  const handleClear = useCallback(
    (action) => {
      updateBinding(action.id, (binding) => ({
        ...binding,
        sources: [],
      }));
    },
    [updateBinding],
  );

  const handleInvert = useCallback(
    (action, axisKey) => {
      updateBinding(action.id, (binding) => {
        const sources = Array.isArray(binding.sources) ? [...binding.sources] : [];
        if (!sources[0]) return binding;
        const next = { ...sources[0] };
        if (axisKey === 'invertX') {
          next.invertX = !next.invertX;
        } else if (axisKey === 'invertY') {
          next.invertY = !next.invertY;
        } else {
          next.invert = !next.invert;
        }
        sources[0] = next;
        return { ...binding, sources };
      });
    },
    [updateBinding],
  );

  const diagnostics = useMemo(() => {
    if (!activePad) return null;
    const outputs = computeGamepadOutputs(activePad, activeProfile);
    return { outputs };
  }, [activePad, activeProfile]);
  const controllerDescription = useMemo(() => describeController(activePad), [activePad]);

  const liveValueForAction = useCallback((actionId) => {
    const outputs = diagnostics?.outputs;
    if (!outputs) return false;
    if (actionId === 'drive') return Math.hypot(outputs.driveVector.x, outputs.driveVector.y) > 0.01;
    if (actionId === 'cameraTilt') return Math.abs(outputs.cameraAxis) > 0.01;
    if (actionId === 'mainBrush') return Math.abs(outputs.auxAxis.main) > 0.01;
    if (actionId === 'sideBrush') return Math.abs(outputs.auxAxis.side) > 0.01;
    return Boolean(outputs.buttons[actionId]);
  }, [diagnostics]);

  return (
    <CardFrame
      title="Controller"
      meta={activePad ? 'Move sticks or press buttons to bind' : 'Connect a controller to configure.'}
      actions={
        <button type="button" disabled={!activePad} onClick={resetActiveProfile} className="button-dark px-1 py-0.5 text-xs disabled:opacity-50">
          Reset profile
        </button>
      }
      bodyClassName="space-y-2 p-1 text-sm"
    >
      {captureAction && (
        <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-1 rounded bg-emerald-950/50 px-1.5 py-1 text-sm text-white">
          <span>Release controls, then move or press the input for {captureAction.label}.</span>
          <button type="button" onClick={() => setCaptureAction(null)} className="button-dark px-1 py-0.5 text-xs">
            Cancel
          </button>
        </div>
      )}

      <div className="space-y-1">
        <SettingsGroupLabel>Connected controller</SettingsGroupLabel>
        {hubState.error ? (
          <p className="mx-auto w-full max-w-lg rounded border border-red-500/60 bg-red-950/40 px-1.5 py-1 text-sm text-white">
            Controller access failed: {hubState.error}
          </p>
        ) : hubState.pads.length === 0 ? (
          <p className="mx-auto w-full max-w-lg text-sm text-white">
            {hubState.supported === false
              ? 'This browser does not support controllers.'
              : 'No controller detected. Connect it, focus this page, then press a button.'}
          </p>
        ) : (
          <div className="mx-auto grid w-full max-w-lg grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded bg-neutral-800/80 px-1.5 py-1 text-sm max-[420px]:grid-cols-1">
            <select
              value={activePad?.instanceKey ?? ''}
              onChange={(event) => setActiveInstanceKey(event.target.value)}
              className="min-w-0 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-sm text-white"
            >
              {hubState.pads.map((pad) => (
                <option key={pad.instanceKey} value={pad.instanceKey}>
                  {pad.id || 'Unknown controller'} (slot {pad.index + 1})
                </option>
              ))}
            </select>
            <span className="rounded bg-neutral-900 px-1 py-0.5 text-xs text-white">
              {activePad?.mapping ?? 'unknown'}
            </span>
            <p className="col-span-full truncate text-xs text-slate-300" title={activePad?.id}>
              {controllerDescription.description ?? activePad?.id}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <SettingsGroupLabel>Calibration</SettingsGroupLabel>
        {/* Calibration controls stay in one stacked column because range inputs become harder to
            tune when squeezed into multiple narrow columns. */}
        <div className="grid gap-1">
          <label className="mx-auto block w-full max-w-lg rounded bg-neutral-800/80 px-1.5 py-1">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 text-sm text-white">
              <span className="font-semibold">Button prompts</span>
              <select
                value={activeProfile.promptStyle ?? 'auto'}
                onChange={(event) => updateProfile({ promptStyle: event.target.value })}
                className="rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-sm text-white"
              >
                <option value="auto">Automatic</option>
                <option value="xbox">Xbox</option>
                <option value="playstation">PlayStation</option>
                <option value="switch">Nintendo</option>
                <option value="standard">Generic</option>
              </select>
            </div>
            <p className="mt-0.5 text-xs leading-snug text-white">Override this only when the browser reports the controller incorrectly.</p>
          </label>
          <SliderField
            label="Drive deadzone"
            description="Ignore small drive stick drift"
            min={0}
            max={0.6}
            step={0.01}
            value={activeProfile.calibration?.driveDeadzone ?? 0.18}
            onChange={(value) => updateCalibration({ driveDeadzone: value })}
          />
          <CurveField
            label="Drive response"
            value={activeProfile.calibration?.driveCurve ?? 'linear'}
            onChange={(value) => updateCalibration({ driveCurve: value })}
          />
          <SliderField
            label="Full-stick speed"
            description="Maximum wheel output at full stick"
            min={50}
            max={500}
            step={10}
            value={activeProfile.calibration?.baseSpeed ?? 500}
            onChange={(value) => updateCalibration({ baseSpeed: value })}
          />
          <SliderField
            label="Turbo drive speed"
            description="Maximum output while holding the turbo modifier"
            min={50}
            max={500}
            step={10}
            value={activeProfile.calibration?.turboSpeed ?? 500}
            onChange={(value) => updateCalibration({ turboSpeed: value })}
          />
          <SliderField
            label="Camera deadzone"
            description="Ignore small camera tilt drift"
            min={0}
            max={0.4}
            step={0.01}
            value={activeProfile.calibration?.cameraDeadzone ?? 0.08}
            onChange={(value) => updateCalibration({ cameraDeadzone: value })}
          />
          <CurveField
            label="Camera response"
            value={activeProfile.calibration?.cameraCurve ?? 'linear'}
            onChange={(value) => updateCalibration({ cameraCurve: value })}
          />
          <SliderField
            label="Aux deadzone"
            description="Ignore small trigger noise"
            min={0}
            max={0.4}
            step={0.01}
            value={activeProfile.calibration?.auxDeadzone ?? 0.05}
            onChange={(value) => updateCalibration({ auxDeadzone: value })}
          />
          <CurveField
            label="Brush response"
            value={activeProfile.calibration?.auxCurve ?? 'linear'}
            onChange={(value) => updateCalibration({ auxCurve: value })}
          />
          <SliderField
            label="Side brush scale"
            description="Scale side brush output"
            min={0.3}
            max={1}
            step={0.05}
            value={activeProfile.calibration?.auxSideScale ?? 0.55}
            onChange={(value) => updateCalibration({ auxSideScale: value })}
          />
          <SliderField
            label="Precision speed"
            description="Maximum drive speed while holding the precision modifier"
            min={20}
            max={250}
            step={5}
            value={activeProfile.calibration?.precisionSpeed ?? 100}
            onChange={(value) => updateCalibration({ precisionSpeed: value })}
          />
          <label className="mx-auto block w-full max-w-lg rounded bg-neutral-800/80 px-1.5 py-1">
            {/* Camera mode is styled like the sliders so calibration controls read as one group
                even though this specific setting is a select instead of a range input. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1.5 text-sm text-white">
              <span className="min-w-0 font-semibold text-white">Camera mode</span>
              <select
                value={activeProfile.calibration?.cameraMode ?? 'velocity'}
                onChange={(event) => updateCalibration({ cameraMode: event.target.value })}
                className="rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-sm text-white"
              >
                <option value="absolute">Absolute</option>
                <option value="velocity">Velocity</option>
              </select>
            </div>
            <p className="mt-0.5 text-xs leading-snug text-white">Absolute maps stick to angle; velocity moves over time.</p>
          </label>
          <SliderField
            label="Camera sensitivity"
            description="Velocity mode degrees per second"
            min={10}
            max={180}
            step={5}
            value={activeProfile.calibration?.cameraSensitivity ?? 60}
            onChange={(value) => updateCalibration({ cameraSensitivity: value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="mx-auto block w-full max-w-lg">
          <span className="sr-only">Filter controller actions</span>
          <input
            type="search"
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
            placeholder="Find a controller action"
            className="field-input w-full px-1.5 py-1 text-sm"
          />
        </label>
        {Object.entries(grouped).map(([section, actions]) => (
          <div key={section} className="space-y-1">
            <SettingsGroupLabel>{section}</SettingsGroupLabel>
            <div className="grid gap-1">
              {actions.map((action) => {
                const binding = activeProfile.bindings?.[action.id];
                const source = binding?.sources?.[0] ?? null;
                // The binding data is unchanged; MappingRow only changes presentation so the
                // existing capture, clear, and invert handlers continue to own behavior.
                return (
                  <MappingRow
                    key={action.id}
                    action={action}
                    source={source}
                    sourceLabel={formatControllerBinding(activeProfile, action.id, activePad)}
                    liveValue={liveValueForAction(action.id)}
                    isCapturing={captureAction?.id === action.id}
                    onClear={handleClear}
                    onCapture={setCaptureAction}
                    onInvert={handleInvert}
                    disabled={!activePad}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {!activePad ? (
          null
        ) : (
          <details className="mx-auto w-full max-w-lg rounded bg-neutral-900/70 px-1.5 py-1 text-xs text-white">
            <summary className="cursor-pointer text-sm font-semibold text-white">Advanced diagnostics</summary>
            <div className="mt-1 space-y-1">
            <p className="text-white">Raw axes</p>
            <div className="grid grid-cols-2 gap-1">
              {activePad.axes.map((value, index) => (
                <span key={`axis-${index}`} className="font-mono text-white">
                  A{index}: {NUMBER_FORMAT.format(value)}
                </span>
              ))}
            </div>
            <p className="text-white">Raw buttons</p>
            <div className="grid grid-cols-2 gap-1">
              {activePad.buttons.map((btn, index) => (
                <span key={`btn-${index}`} className="font-mono text-white">
                  B{index}: {NUMBER_FORMAT.format(btn.value)} {btn.pressed ? '●' : ''}
                </span>
              ))}
            </div>
            {diagnostics?.outputs && (
              <>
                <p className="text-white">Mapped outputs</p>
                <div className="grid grid-cols-2 gap-1">
                  <span className="font-mono text-white">
                    Drive: {NUMBER_FORMAT.format(diagnostics.outputs.driveVector.x)},{' '}
                    {NUMBER_FORMAT.format(diagnostics.outputs.driveVector.y)}
                  </span>
                  <span className="font-mono text-white">
                    Camera: {NUMBER_FORMAT.format(diagnostics.outputs.cameraAxis)}
                  </span>
                  <span className="font-mono text-white">
                    Main: {NUMBER_FORMAT.format(diagnostics.outputs.auxAxis.main)}
                  </span>
                  <span className="font-mono text-white">
                    Side: {NUMBER_FORMAT.format(diagnostics.outputs.auxAxis.side)}
                  </span>
                </div>
              </>
            )}
            </div>
          </details>
        )}
      </div>
    </CardFrame>
  );
}
