import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsNamespace } from '../../settings/index.js';
import { GAMEPAD_PROFILE_DEFAULT, GAMEPAD_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';
import {
  computeGamepadOutputs,
  createProfileForPad,
} from '../../controls/inputs/gamepadBindings.js';
import { useGamepadHubState } from '../../controls/inputs/gamepadHub.js';
import SliderField from './SliderField.jsx';
import { ACTIONS, NUMBER_FORMAT } from './constants.js';
import {
  formatSource,
  groupActions,
  pickActivePad,
  snapshotBaseline,
  buildDescriptorFromCapture,
} from './helpers.js';

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
    <section className="panel-section space-y-0.5 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">Controller</p>
          <p className="text-[0.65rem] text-slate-500">
            {activePad ? 'Move sticks or press buttons to bind' : 'Connect a controller to configure.'}
          </p>
          {captureAction && (
            <p className="mt-0 text-[0.7rem] text-emerald-400">Capturing {captureAction.label}…</p>
          )}
        </div>
      </div>

      <div className="space-y-0.5 surface">
        <p className="text-[0.7rem] text-slate-500">Connected controller</p>
        {hubState.pads.length === 0 ? (
          <p className="text-[0.7rem] text-slate-400">No controller detected.</p>
        ) : (
          <div className="flex items-center justify-between gap-0.5 text-xs">
            <select
              value={activeSignature ?? ''}
              onChange={(event) => setActiveSignature(event.target.value)}
              className="flex-1 rounded border border-slate-700 bg-slate-900 px-1 py-[2px] text-[0.75rem] text-slate-100"
            >
              {hubState.pads.map((pad) => (
                <option key={pad.signature} value={pad.signature}>
                  {pad.id || 'Unknown controller'}
                </option>
              ))}
            </select>
            <span className="text-[0.7rem] text-slate-400">{activePad?.mapping ?? 'unknown'}</span>
          </div>
        )}
      </div>

      <div className="space-y-0.5 surface">
        <p className="text-[0.7rem] text-slate-500">Calibration</p>
        <div className="space-y-0.5">
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
          <label className="surface-muted block p-0.5">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="font-semibold text-slate-100">Camera mode</span>
              <select
                value={activeProfile.calibration?.cameraMode ?? 'absolute'}
                onChange={(event) => updateCalibration({ cameraMode: event.target.value })}
                className="rounded border border-slate-700 bg-slate-900 px-1 py-[2px] text-[0.75rem] text-slate-100"
              >
                <option value="absolute">Absolute</option>
                <option value="velocity">Velocity</option>
              </select>
            </div>
            <p className="text-[0.65rem] text-slate-500">Absolute maps stick to angle; velocity moves over time.</p>
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

      <div className="space-y-0.5">
        {Object.entries(grouped).map(([section, actions]) => (
          <div key={section} className="space-y-0.5 surface">
            <p className="text-[0.7rem] text-slate-500">{section}</p>
            <div className="space-y-0.5">
              {actions.map((action) => {
                const binding = activeProfile.bindings?.[action.id];
                const source = binding?.sources?.[0] ?? null;
                return (
                  <div key={action.id} className="surface-muted flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-slate-100">{action.label}</p>
                      <p className="text-[0.65rem] text-slate-400">{formatSource(source)}</p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {action.kind === 'axisPair' && (
                        <>
                          <button
                            type="button"
                            disabled={!source}
                            onClick={() => handleInvert(action, 'invertX')}
                            className="button-dark text-[0.7rem] font-medium disabled:opacity-50"
                          >
                            Invert X
                          </button>
                          <button
                            type="button"
                            disabled={!source}
                            onClick={() => handleInvert(action, 'invertY')}
                            className="button-dark text-[0.7rem] font-medium disabled:opacity-50"
                          >
                            Invert Y
                          </button>
                        </>
                      )}
                      {action.kind === 'axis' && (
                        <button
                          type="button"
                          disabled={!source}
                          onClick={() => handleInvert(action)}
                          className="button-dark text-[0.7rem] font-medium disabled:opacity-50"
                        >
                          Invert
                        </button>
                      )}
                      <button type="button" onClick={() => handleClear(action)} className="button-dark text-[0.7rem]">
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaptureAction(action)}
                        className={`${
                          captureAction?.id === action.id
                            ? 'px-0.5 py-0.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
                            : 'button-dark'
                        } text-[0.7rem] font-medium`}
                      >
                        {captureAction?.id === action.id ? 'Waiting…' : 'Capture'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-0.5 surface">
        <p className="text-[0.7rem] text-slate-500">Diagnostics</p>
        {!activePad ? (
          <p className="text-[0.7rem] text-slate-400">No controller detected.</p>
        ) : (
          <div className="space-y-0.5 text-[0.7rem] text-slate-300">
            <p className="text-slate-400">Raw axes</p>
            <div className="grid grid-cols-2 gap-0.5">
              {activePad.axes.map((value, index) => (
                <span key={`axis-${index}`} className="font-mono text-slate-300">
                  A{index}: {NUMBER_FORMAT.format(value)}
                </span>
              ))}
            </div>
            <p className="text-slate-400">Raw buttons</p>
            <div className="grid grid-cols-2 gap-0.5">
              {activePad.buttons.map((btn, index) => (
                <span key={`btn-${index}`} className="font-mono text-slate-300">
                  B{index}: {NUMBER_FORMAT.format(btn.value)} {btn.pressed ? '●' : ''}
                </span>
              ))}
            </div>
            {diagnostics?.outputs && (
              <>
                <p className="text-slate-400">Mapped outputs</p>
                <div className="grid grid-cols-2 gap-0.5">
                  <span className="font-mono text-slate-300">
                    Drive: {NUMBER_FORMAT.format(diagnostics.outputs.driveVector.x)},{' '}
                    {NUMBER_FORMAT.format(diagnostics.outputs.driveVector.y)}
                  </span>
                  <span className="font-mono text-slate-300">
                    Camera: {NUMBER_FORMAT.format(diagnostics.outputs.cameraAxis)}
                  </span>
                  <span className="font-mono text-slate-300">
                    Main: {NUMBER_FORMAT.format(diagnostics.outputs.auxAxis.main)}
                  </span>
                  <span className="font-mono text-slate-300">
                    Side: {NUMBER_FORMAT.format(diagnostics.outputs.auxAxis.side)}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
