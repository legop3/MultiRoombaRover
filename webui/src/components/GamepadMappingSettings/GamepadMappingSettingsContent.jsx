// Gamepad Mapping Settings Content
// Purpose: Defines the Gamepad Mapping Settings Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsNamespace } from '../../settings/index.js';
import { GAMEPAD_PROFILE_DEFAULT, GAMEPAD_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import {
  computeGamepadOutputs,
  createProfileForPad,
} from '../../controls/inputs/gamepadBindings.js';
import { useGamepadHubState } from '../../controls/inputs/gamepadHub.js';
import CardFrame from '../CardFrame/index.jsx';
import SliderField from './SliderField.jsx';
import { ACTIONS, NUMBER_FORMAT } from './constants.js';
import {
  formatSource,
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

function MappingRow({
  action,
  source,
  isCapturing,
  onClear,
  onCapture,
  onInvert,
}) {
  // Mapping rows are constrained to a readable width so the source text and buttons remain
  // visually connected. Buttons wrap on very narrow panes instead of forcing tiny text.
  return (
    <div className="mx-auto grid w-full max-w-lg grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded bg-neutral-800/80 px-1.5 py-1 text-sm max-[520px]:grid-cols-1">
      <div className="min-w-0">
        <p className="font-semibold leading-snug text-white">{action.label}</p>
        <p className="mt-0.5 text-xs leading-snug text-white">{formatSource(source)}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1 max-[520px]:justify-start">
        {/* Axis-pair controls expose independent inversion because stick X/Y directions often
            differ between browser mappings. Keeping those buttons beside the source avoids
            making users hunt across a wide row while testing a binding. */}
        {action.kind === 'axisPair' && (
          <>
            <button
              type="button"
              disabled={!source}
              onClick={() => onInvert(action, 'invertX')}
              className="button-dark px-1 py-0.5 text-xs font-medium disabled:opacity-50"
            >
              Invert X
            </button>
            <button
              type="button"
              disabled={!source}
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
            disabled={!source}
            onClick={() => onInvert(action)}
            className="button-dark px-1 py-0.5 text-xs font-medium disabled:opacity-50"
          >
            Invert
          </button>
        )}
        {/* Clear and Capture are always present because they are the primary row actions. They
            wrap with the inversion controls on narrow panes instead of shrinking text. */}
        <button type="button" onClick={() => onClear(action)} className="button-dark px-1 py-0.5 text-xs">
          Clear
        </button>
        <button
          type="button"
          onClick={() => onCapture(action)}
          className={`${
            isCapturing
              ? 'rounded-md bg-emerald-500 px-1 py-0.5 text-emerald-950 hover:bg-emerald-400'
              : 'button-dark px-1 py-0.5'
          } text-xs font-medium`}
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
  const baselineRef = useRef(null);
  const grouped = useMemo(() => groupActions(ACTIONS), []);

  const activePad = useMemo(
    () => pickActivePad(hubState.pads, gamepadSettings.activeSignature),
    [hubState.pads, gamepadSettings.activeSignature],
  );

  const activeSignature = activePad?.signature ?? null;
  const activeProfile = useMemo(() => {
    if (!activeSignature) {
      return gamepadSettings?.defaults?.profile ?? GAMEPAD_PROFILE_DEFAULT;
    }
    return (
      gamepadSettings?.profiles?.[activeSignature] ??
      gamepadSettings?.defaults?.profile ??
      GAMEPAD_PROFILE_DEFAULT
    );
  }, [activeSignature, gamepadSettings?.defaults?.profile, gamepadSettings?.profiles]);

  useEffect(() => {
    if (!activePad || !activeSignature) return;
    if (gamepadSettings?.profiles?.[activeSignature]) return;
    saveGamepadSettings((prev) => {
      const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
      if (current.profiles?.[activeSignature]) return current;
      const base = current?.defaults?.profile ?? GAMEPAD_PROFILE_DEFAULT;
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
  }, [captureAction, activeSignature]);

  useEffect(() => {
    if (!captureAction || !activePad) return;
    if (!baselineRef.current) {
      baselineRef.current = snapshotBaseline(activePad);
      return;
    }
    const descriptor = buildDescriptorFromCapture(activePad, baselineRef.current, captureAction);
    if (!descriptor) return;
    saveGamepadSettings((prev) => {
      const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
      const baseProfile =
        current.profiles?.[activeSignature] ?? current?.defaults?.profile ?? GAMEPAD_PROFILE_DEFAULT;
      const nextProfile = {
        ...baseProfile,
        bindings: {
          ...(baseProfile.bindings ?? {}),
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
    setCaptureAction(null);
  }, [activePad, activeSignature, captureAction, saveGamepadSettings]);

  const setActiveSignature = useCallback(
    (signature) => {
      saveGamepadSettings((prev) => ({
        ...(prev ?? GAMEPAD_SETTINGS_DEFAULTS),
        activeSignature: signature || null,
      }));
    },
    [saveGamepadSettings],
  );

  const updateCalibration = useCallback(
    (patch) => {
      saveGamepadSettings((prev) => {
        const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
        const baseProfile =
          (activeSignature && current.profiles?.[activeSignature]) ??
          current?.defaults?.profile ??
          GAMEPAD_PROFILE_DEFAULT;
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

  const updateBinding = useCallback(
    (actionId, updater) => {
      saveGamepadSettings((prev) => {
        const current = prev ?? GAMEPAD_SETTINGS_DEFAULTS;
        const baseProfile =
          (activeSignature && current.profiles?.[activeSignature]) ??
          current?.defaults?.profile ??
          GAMEPAD_PROFILE_DEFAULT;
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

  return (
    <CardFrame
      title="Controller"
      meta={activePad ? 'Move sticks or press buttons to bind' : 'Connect a controller to configure.'}
      bodyClassName="space-y-2 p-1 text-sm"
    >
      {captureAction && (
        <p className="mx-auto w-full max-w-lg rounded bg-emerald-950/50 px-1.5 py-1 text-sm text-white">
          Capturing {captureAction.label}...
        </p>
      )}

      <div className="space-y-1">
        <SettingsGroupLabel>Connected controller</SettingsGroupLabel>
        {hubState.pads.length === 0 ? (
          <p className="mx-auto w-full max-w-lg text-sm text-white">No controller detected.</p>
        ) : (
          <div className="mx-auto grid w-full max-w-lg grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded bg-neutral-800/80 px-1.5 py-1 text-sm max-[420px]:grid-cols-1">
            <select
              value={activeSignature ?? ''}
              onChange={(event) => setActiveSignature(event.target.value)}
              className="min-w-0 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-sm text-white"
            >
              {hubState.pads.map((pad) => (
                <option key={pad.signature} value={pad.signature}>
                  {pad.id || 'Unknown controller'}
                </option>
              ))}
            </select>
            <span className="rounded bg-neutral-900 px-1 py-0.5 text-xs text-white">
              {activePad?.mapping ?? 'unknown'}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <SettingsGroupLabel>Calibration</SettingsGroupLabel>
        {/* Calibration controls stay in one stacked column because range inputs become harder to
            tune when squeezed into multiple narrow columns. */}
        <div className="grid gap-1">
          <SliderField
            label="Drive deadzone"
            description="Ignore small drive stick drift"
            min={0}
            max={0.6}
            step={0.01}
            value={activeProfile.calibration?.driveDeadzone ?? 0.18}
            onChange={(value) => updateCalibration({ driveDeadzone: value })}
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
          <SliderField
            label="Aux deadzone"
            description="Ignore small trigger noise"
            min={0}
            max={0.4}
            step={0.01}
            value={activeProfile.calibration?.auxDeadzone ?? 0.05}
            onChange={(value) => updateCalibration({ auxDeadzone: value })}
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
          <label className="mx-auto block w-full max-w-lg rounded bg-neutral-800/80 px-1.5 py-1">
            {/* Camera mode is styled like the sliders so calibration controls read as one group
                even though this specific setting is a select instead of a range input. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1.5 text-sm text-white">
              <span className="min-w-0 font-semibold text-white">Camera mode</span>
              <select
                value={activeProfile.calibration?.cameraMode ?? 'absolute'}
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
                    isCapturing={captureAction?.id === action.id}
                    onClear={handleClear}
                    onCapture={setCaptureAction}
                    onInvert={handleInvert}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <SettingsGroupLabel>Diagnostics</SettingsGroupLabel>
        {!activePad ? (
          <p className="mx-auto w-full max-w-lg text-sm text-white">No controller detected.</p>
        ) : (
          <div className="mx-auto w-full max-w-lg space-y-1 rounded bg-neutral-900/70 px-1.5 py-1 text-xs text-white">
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
        )}
      </div>
    </CardFrame>
  );
}
