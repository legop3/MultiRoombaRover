import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import RoverRoster from './RoverRoster.jsx';
import ChatMessageRow from './ChatMessageRow.jsx';
import { roverNameChromeStyle } from '../lib/roverColor.js';

const MODES = [
  { key: 'open', label: 'Open' },
  { key: 'turns', label: 'Turns' },
  { key: 'admin', label: 'Admin' },
  { key: 'lockdown', label: 'Lockdown' },
];

export default function AdminPanel() {
  const {
    session,
    lockRover,
    setMode,
    requestControl,
    setCommunityGoal,
    setAdminReason,
    rebootRover,
    rebootServer,
    setAudioLevels,
    setPrivateSafety,
    llmControl,
    visionHumanState,
    getVisionHumanState,
    updateVisionHumanConfig,
    testVisionHumanTts,
    testVisionHumanDiscord,
    clearVisionHumanState,
    adminLogs,
    llmCommentaryState,
  } = useSession();
  const roster = useMemo(() => session?.roster ?? [], [session?.roster]);
  const [lockStates, setLockStates] = useState({});
  const [rebootStates, setRebootStates] = useState({});
  const [serverRebooting, setServerRebooting] = useState(false);
  const [clearingLlmHistory, setClearingLlmHistory] = useState(false);
  const health = session?.health || null;
  const currentGoal = session?.communityGoal?.text || '';
  const goalUpdatedAt = session?.communityGoal?.updatedAt || null;
  const [goalDraft, setGoalDraft] = useState(currentGoal);
  const currentReason = session?.adminReason?.text || '';
  const reasonUpdatedAt = session?.adminReason?.updatedAt || null;
  const [reasonDraft, setReasonDraft] = useState(currentReason);
  const currentAudioLevels = session?.audioLevels || {};
  const [audioLevelDraft, setAudioLevelDraft] = useState({
    hornGain: Number.isFinite(currentAudioLevels.hornGain) ? currentAudioLevels.hornGain : 1,
    ttsGain: Number.isFinite(currentAudioLevels.ttsGain) ? currentAudioLevels.ttsGain : 1,
    forwardGain: Number.isFinite(currentAudioLevels.forwardGain) ? currentAudioLevels.forwardGain : 1,
  });
  const [privateSafetyDrafts, setPrivateSafetyDrafts] = useState({});
  const [visionDraft, setVisionDraft] = useState(null);

  const isAdmin =
    session?.role === 'admin' ||
    session?.role === 'lockdown' ||
    session?.role === 'lockdown-admin';
  const isLockdownAdmin = session?.role === 'lockdown' || session?.role === 'lockdown-admin';

  const currentMode = session?.mode ?? 'open';

  const handleLockToggle = async (roverId, locked) => {
    try {
      await lockRover(roverId, locked);
      setLockStates((prev) => ({ ...prev, [roverId]: locked }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleModeChange = async (event) => {
    const mode = event.target.value;
    try {
      await setMode(mode);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleForceControl = async (roverId) => {
    try {
      await requestControl(roverId, { force: true });
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReboot = async (rover) => {
    if (!rover?.id) return;
    const ok = window.confirm(`Reboot rover "${rover.name || rover.id}" now?`);
    if (!ok) return;
    setRebootStates((prev) => ({ ...prev, [rover.id]: true }));
    try {
      await rebootRover(rover.id);
    } catch (err) {
      alert(err.message);
    } finally {
      setRebootStates((prev) => ({ ...prev, [rover.id]: false }));
    }
  };

  const handleServerReboot = async () => {
    const ok = window.confirm('Reboot the server host now? This will disconnect all users.');
    if (!ok) return;
    setServerRebooting(true);
    try {
      await rebootServer();
    } catch (err) {
      alert(err.message);
      setServerRebooting(false);
    }
  };

  const handleClearLlmHistory = async () => {
    const ok = window.confirm(
      'Clear LLM commentary history now? This resets chat context, bot memory, and rover activity metrics for narration.',
    );
    if (!ok) return;
    setClearingLlmHistory(true);
    try {
      await llmControl('clearHistory');
    } catch (err) {
      alert(err.message);
    } finally {
      setClearingLlmHistory(false);
    }
  };

  const handleGoalSave = async () => {
    try {
      await setCommunityGoal(goalDraft);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleGoalClear = async () => {
    try {
      await setCommunityGoal(null);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReasonSave = async () => {
    try {
      await setAdminReason(reasonDraft);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReasonClear = async () => {
    try {
      await setAdminReason(null);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAudioLevelDraft = (key) => (event) => {
    const next = Number(event.target.value);
    setAudioLevelDraft((current) => ({ ...(current || {}), [key]: Number.isFinite(next) ? next : 1 }));
  };

  const handleAudioLevelsSave = async () => {
    try {
      await setAudioLevels(audioLevelDraft);
    } catch (err) {
      alert(err.message);
    }
  };

  useEffect(() => {
    setGoalDraft(currentGoal);
  }, [currentGoal]);

  useEffect(() => {
    setReasonDraft(currentReason);
  }, [currentReason]);

  useEffect(() => {
    setAudioLevelDraft({
      hornGain: Number.isFinite(currentAudioLevels.hornGain) ? currentAudioLevels.hornGain : 1,
      ttsGain: Number.isFinite(currentAudioLevels.ttsGain) ? currentAudioLevels.ttsGain : 1,
      forwardGain: Number.isFinite(currentAudioLevels.forwardGain) ? currentAudioLevels.forwardGain : 1,
    });
  }, [currentAudioLevels.forwardGain, currentAudioLevels.hornGain, currentAudioLevels.ttsGain]);

  useEffect(() => {
    const source = visionHumanState?.config;
    if (!source) return;
    setVisionDraft({
      enabled: Boolean(visionHumanState?.enabled),
      confidenceThreshold: Number.isFinite(Number(source.confidenceThreshold))
        ? Number(source.confidenceThreshold)
        : 0.55,
      ttsDelayMs: Number.isFinite(Number(source.ttsDelayMs)) ? Number(source.ttsDelayMs) : 30000,
      discordDelayMs: Number.isFinite(Number(source.discordDelayMs)) ? Number(source.discordDelayMs) : 60000,
      clearWindowMs: Number.isFinite(Number(source.clearWindowMs)) ? Number(source.clearWindowMs) : 3000,
      cooldownMs: Number.isFinite(Number(source.cooldownMs)) ? Number(source.cooldownMs) : 900000,
      maxInferenceFpsPerCamera: Number.isFinite(Number(source.maxInferenceFpsPerCamera))
        ? Number(source.maxInferenceFpsPerCamera)
        : 3,
    });
  }, [visionHumanState]);

  useEffect(() => {
    const next = {};
    (roster || []).forEach((rover) => {
      if (!rover?.private?.enabled) return;
      next[rover.id] = {
        speedLimitEnabled: Boolean(rover?.private?.safety?.speedLimitEnabled),
        speedLimitMaxWheelSpeed: Number.isFinite(rover?.private?.safety?.speedLimitMaxWheelSpeed)
          ? rover.private.safety.speedLimitMaxWheelSpeed
          : 250,
        hardOvercurrentEnabled: Boolean(rover?.private?.safety?.hardOvercurrentEnabled),
        overcurrentStopMs: Number.isFinite(rover?.private?.safety?.overcurrentStopMs)
          ? rover.private.safety.overcurrentStopMs
          : 300,
        hardBumpEnabled: Boolean(rover?.private?.safety?.hardBumpEnabled),
        bumpBackoffSpeed: Number.isFinite(rover?.private?.safety?.bumpBackoffSpeed)
          ? rover.private.safety.bumpBackoffSpeed
          : 250,
        bumpBackoffMs: Number.isFinite(rover?.private?.safety?.bumpBackoffMs)
          ? rover.private.safety.bumpBackoffMs
          : 350,
        cliffEnabled: Boolean(rover?.private?.safety?.cliffEnabled),
        cliffBackoffSpeed: Number.isFinite(rover?.private?.safety?.cliffBackoffSpeed)
          ? rover.private.safety.cliffBackoffSpeed
          : 250,
        cliffBackoffMs: Number.isFinite(rover?.private?.safety?.cliffBackoffMs)
          ? rover.private.safety.cliffBackoffMs
          : 500,
        triggerCooldownMs: Number.isFinite(rover?.private?.safety?.triggerCooldownMs)
          ? rover.private.safety.triggerCooldownMs
          : 800,
      };
    });
    setPrivateSafetyDrafts(next);
  }, [roster]);

  const lockMap = useMemo(() => {
    const map = {};
    roster.forEach((rover) => {
      map[rover.id] = lockStates[rover.id] ?? rover.locked;
    });
    return map;
  }, [roster, lockStates]);

  const updatePrivateSafetyDraft = (roverId, patch = {}) => {
    setPrivateSafetyDrafts((current) => ({
      ...(current || {}),
      [roverId]: { ...(current?.[roverId] || {}), ...(patch || {}) },
    }));
  };

  const handlePrivateSafetySave = async (roverId) => {
    try {
      const draft = privateSafetyDrafts?.[roverId];
      if (!draft) return;
      await setPrivateSafety(roverId, draft);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRefreshVision = async () => {
    try {
      await getVisionHumanState();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleVisionDraftChange = (key) => (event) => {
    if (!visionDraft) return;
    const isCheckbox = event.target.type === 'checkbox';
    const value = isCheckbox ? Boolean(event.target.checked) : Number(event.target.value);
    setVisionDraft((current) => ({ ...(current || {}), [key]: isCheckbox ? value : value }));
  };

  const handleSaveVisionConfig = async () => {
    if (!visionDraft) return;
    try {
      await updateVisionHumanConfig(visionDraft);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleVisionTestTts = async () => {
    try {
      await testVisionHumanTts();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleVisionTestDiscord = async () => {
    try {
      await testVisionHumanDiscord();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleVisionClear = async () => {
    try {
      await clearVisionHumanState();
    } catch (err) {
      alert(err.message);
    }
  };

  if (!isAdmin) return null;

  return (
    <section className="panel-section space-y-0.5 text-base">
      <div className="flex items-center justify-between gap-0.5 text-sm">
        <span>Admin controls</span>
        <select value={currentMode} onChange={handleModeChange} className="field-input text-sm">
          {MODES.map((mode) => (
            <option key={mode.key} value={mode.key}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-0.5 text-xs">
        <button
          type="button"
          onClick={handleServerReboot}
          disabled={serverRebooting}
          className="button-danger disabled:cursor-not-allowed disabled:opacity-60"
        >
          {serverRebooting ? 'Server rebooting...' : 'Reboot Server'}
        </button>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Global audio levels</span>
          {session?.audioLevels?.updatedAt ? (
            <span>Updated {new Date(session.audioLevels.updatedAt).toLocaleString()}</span>
          ) : null}
        </div>
        <label className="grid gap-0.5 text-xs text-slate-200">
          <div className="flex items-center justify-between gap-0.5">
            <span>Horn gain</span>
            <span>{audioLevelDraft.hornGain.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0"
            max="4"
            step="0.01"
            value={audioLevelDraft.hornGain}
            onChange={handleAudioLevelDraft('hornGain')}
            className="w-full accent-emerald-500"
          />
        </label>
        <label className="grid gap-0.5 text-xs text-slate-200">
          <div className="flex items-center justify-between gap-0.5">
            <span>TTS gain</span>
            <span>{audioLevelDraft.ttsGain.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0"
            max="4"
            step="0.01"
            value={audioLevelDraft.ttsGain}
            onChange={handleAudioLevelDraft('ttsGain')}
            className="w-full accent-emerald-500"
          />
        </label>
        <label className="grid gap-0.5 text-xs text-slate-200">
          <div className="flex items-center justify-between gap-0.5">
            <span>Forward gain</span>
            <span>{audioLevelDraft.forwardGain.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0"
            max="4"
            step="0.01"
            value={audioLevelDraft.forwardGain}
            onChange={handleAudioLevelDraft('forwardGain')}
            className="w-full accent-emerald-500"
          />
        </label>
        <div className="flex gap-0.5 text-xs">
          <button type="button" onClick={handleAudioLevelsSave} className="button-dark">
            Apply audio levels
          </button>
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Community goal</span>
          {goalUpdatedAt ? (
            <span>Updated {new Date(goalUpdatedAt).toLocaleString()}</span>
          ) : null}
        </div>
        <input
          type="text"
          value={goalDraft}
          onChange={(event) => setGoalDraft(event.target.value)}
          placeholder="Set a community goal"
          className="field-input text-sm"
        />
        <div className="flex gap-0.5 text-xs">
          <button type="button" onClick={handleGoalSave} className="button-dark">
            Set goal
          </button>
          <button type="button" onClick={handleGoalClear} className="button-danger">
            Clear
          </button>
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Admin mode reason</span>
          {reasonUpdatedAt ? (
            <span>Updated {new Date(reasonUpdatedAt).toLocaleString()}</span>
          ) : null}
        </div>
        <textarea
          value={reasonDraft}
          onChange={(event) => setReasonDraft(event.target.value)}
          placeholder="Set an admin mode reason"
          className="field-input text-sm min-h-[3.5rem]"
        />
        <div className="flex gap-0.5 text-xs">
          <button type="button" onClick={handleReasonSave} className="button-dark">
            Set reason
          </button>
          <button type="button" onClick={handleReasonClear} className="button-danger">
            Clear
          </button>
        </div>
      </div>

      <RoverRoster
        roster={roster}
        renderActions={(rover) => (
          <div className="flex flex-wrap items-center gap-0.5 text-xs">
            <button
              type="button"
              onClick={() => handleLockToggle(rover.id, !lockMap[rover.id])}
              className="button-dark"
            >
              {lockMap[rover.id] ? 'Unlock' : 'Lock'}
            </button>
            <button type="button" onClick={() => handleForceControl(rover.id)} className="button-dark">
              Force
            </button>
            <button
              type="button"
              onClick={() => handleReboot(rover)}
              disabled={Boolean(rebootStates[rover.id])}
              className="button-danger disabled:cursor-not-allowed disabled:opacity-60"
            >
              {rebootStates[rover.id] ? 'Rebooting...' : 'Reboot'}
            </button>
            {rover?.private?.enabled ? (
              <div className="w-full rounded border border-slate-700/70 p-0.5 space-y-0.5 text-[0.7rem]">
                <div className="text-slate-300">Private safety</div>
                <label className="flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={Boolean(privateSafetyDrafts?.[rover.id]?.speedLimitEnabled)}
                    disabled={!isLockdownAdmin}
                    onChange={(event) =>
                      updatePrivateSafetyDraft(rover.id, { speedLimitEnabled: Boolean(event.target.checked) })}
                  />
                  <span>Speed limit</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  className="field-input text-xs w-20"
                  disabled={!isLockdownAdmin}
                  value={privateSafetyDrafts?.[rover.id]?.speedLimitMaxWheelSpeed ?? 250}
                  onChange={(event) =>
                    updatePrivateSafetyDraft(rover.id, {
                      speedLimitMaxWheelSpeed: Number(event.target.value) || 250,
                    })}
                />
                <label className="flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={Boolean(privateSafetyDrafts?.[rover.id]?.hardOvercurrentEnabled)}
                    disabled={!isLockdownAdmin}
                    onChange={(event) =>
                      updatePrivateSafetyDraft(rover.id, { hardOvercurrentEnabled: Boolean(event.target.checked) })}
                  />
                  <span>Hard overcurrent</span>
                </label>
                <label className="flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={Boolean(privateSafetyDrafts?.[rover.id]?.hardBumpEnabled)}
                    disabled={!isLockdownAdmin}
                    onChange={(event) =>
                      updatePrivateSafetyDraft(rover.id, { hardBumpEnabled: Boolean(event.target.checked) })}
                  />
                  <span>Hard bump</span>
                </label>
                <label className="flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={Boolean(privateSafetyDrafts?.[rover.id]?.cliffEnabled)}
                    disabled={!isLockdownAdmin}
                    onChange={(event) =>
                      updatePrivateSafetyDraft(rover.id, { cliffEnabled: Boolean(event.target.checked) })}
                  />
                  <span>Cliff safety</span>
                </label>
                <button
                  type="button"
                  disabled={!isLockdownAdmin}
                  onClick={() => handlePrivateSafetySave(rover.id)}
                  className="button-dark disabled:opacity-50"
                >
                  Apply Safety
                </button>
              </div>
            ) : null}
          </div>
        )}
      />
      <ReplaySnapshotHealth health={health} roster={roster} />
      <VisionHumanPanel
        state={visionHumanState}
        draft={visionDraft}
        onDraftChange={handleVisionDraftChange}
        onRefresh={handleRefreshVision}
        onSaveConfig={handleSaveVisionConfig}
        onTestTts={handleVisionTestTts}
        onTestDiscord={handleVisionTestDiscord}
        onClear={handleVisionClear}
      />
      <LlmCommentaryPanel
        state={llmCommentaryState}
        onClearHistory={handleClearLlmHistory}
        clearingHistory={clearingLlmHistory}
      />
      <AdminIpLogPanel entries={adminLogs} />
    </section>
  );
}

function VisionHumanPanel({
  state,
  draft,
  onDraftChange,
  onRefresh,
  onSaveConfig,
  onTestTts,
  onTestDiscord,
  onClear,
}) {
  if (!state) {
    return (
      <div className="space-y-0.5">
        <div className="panel-muted text-xs uppercase">Human Detection</div>
        <div className="surface text-xs text-slate-300">No human detection state received yet.</div>
      </div>
    );
  }
  const modeGateText = state.modeActive ? 'active' : `inactive in ${state.mode}`;
  const workerText = state.workerReady ? 'ready' : state.workerRunning ? 'starting' : 'offline';
  const episode = state.episode || {};
  const history = Array.isArray(state.history) ? state.history : [];
  const cameras = Array.isArray(state.cameras) ? state.cameras : [];
  const statusPills = [
    { label: 'enabled', value: state.enabled ? 'yes' : 'no' },
    { label: 'mode gate', value: modeGateText },
    { label: 'worker', value: workerText },
    { label: 'python', value: state.workerPython || '--' },
    { label: 'worker restarts', value: state.workerRestartCount ?? 0 },
    { label: 'present', value: episode.humanPresent ? 'yes' : 'no' },
    { label: 'tts sent', value: episode.ttsSentThisEpisode ? 'yes' : 'no' },
    { label: 'discord sent', value: episode.discordSentThisEpisode ? 'yes' : 'no' },
    { label: 'tts in', value: `${Math.ceil((episode.timeToTtsMs || 0) / 1000)}s` },
    { label: 'discord in', value: `${Math.ceil((episode.timeToDiscordMs || 0) / 1000)}s` },
    { label: 'cooldown', value: `${Math.ceil((episode.cooldownRemainingMs || 0) / 1000)}s` },
  ];
  return (
    <div className="space-y-0.5">
      <div className="panel-muted text-xs uppercase">Human Detection</div>
      <div className="flex flex-wrap gap-0.5 text-xs">
        <button type="button" onClick={onRefresh} className="button-dark">
          Refresh
        </button>
        <button type="button" onClick={onSaveConfig} className="button-dark">
          Save Detection Config
        </button>
        <button type="button" onClick={onTestTts} className="button-dark">
          Test TTS
        </button>
        <button type="button" onClick={onTestDiscord} className="button-dark">
          Test Discord
        </button>
        <button type="button" onClick={onClear} className="button-danger">
          Clear Episode
        </button>
      </div>
      <div className="surface flex flex-wrap gap-0.5 text-xs">
        {statusPills.map((pill) => (
          <span
            key={pill.label}
            className="rounded border border-slate-600/60 bg-slate-800/70 px-0.5 py-0.25 text-[0.72rem] leading-tight text-slate-200"
          >
            {pill.label}: {pill.value}
          </span>
        ))}
      </div>
      {draft ? (
        <div className="grid gap-0.5 md:grid-cols-2">
          <label className="surface flex items-center justify-between gap-0.5 text-xs">
            <span>Enabled</span>
            <input type="checkbox" checked={Boolean(draft.enabled)} onChange={onDraftChange('enabled')} />
          </label>
          <label className="surface grid gap-0.25 text-xs">
            <span>Confidence threshold</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={draft.confidenceThreshold}
              onChange={onDraftChange('confidenceThreshold')}
              className="field-input text-xs"
            />
          </label>
          <label className="surface grid gap-0.25 text-xs">
            <span>TTS delay (ms)</span>
            <input
              type="number"
              min="1000"
              step="250"
              value={draft.ttsDelayMs}
              onChange={onDraftChange('ttsDelayMs')}
              className="field-input text-xs"
            />
          </label>
          <label className="surface grid gap-0.25 text-xs">
            <span>Discord delay (ms)</span>
            <input
              type="number"
              min="1000"
              step="250"
              value={draft.discordDelayMs}
              onChange={onDraftChange('discordDelayMs')}
              className="field-input text-xs"
            />
          </label>
          <label className="surface grid gap-0.25 text-xs">
            <span>Clear window (ms)</span>
            <input
              type="number"
              min="250"
              step="250"
              value={draft.clearWindowMs}
              onChange={onDraftChange('clearWindowMs')}
              className="field-input text-xs"
            />
          </label>
          <label className="surface grid gap-0.25 text-xs">
            <span>Cooldown (ms)</span>
            <input
              type="number"
              min="0"
              step="1000"
              value={draft.cooldownMs}
              onChange={onDraftChange('cooldownMs')}
              className="field-input text-xs"
            />
          </label>
          <label className="surface grid gap-0.25 text-xs">
            <span>Max inference FPS/camera</span>
            <input
              type="number"
              min="0.25"
              max="30"
              step="0.25"
              value={draft.maxInferenceFpsPerCamera}
              onChange={onDraftChange('maxInferenceFpsPerCamera')}
              className="field-input text-xs"
            />
          </label>
        </div>
      ) : null}
      <div className="space-y-0.5">
        <div className="panel-muted text-xs uppercase">Per Camera</div>
        <div className="surface max-h-40 overflow-y-auto text-xs text-slate-200">
          {cameras.length ? (
            cameras.map((cam) => (
              <div key={cam.cameraId} className="flex items-center justify-between gap-0.5">
                <span>{cam.cameraId}</span>
                <span>{cam.lastConfidence?.toFixed?.(2) ?? '0.00'}</span>
                <span>{cam.lastPositiveAt ? new Date(cam.lastPositiveAt).toLocaleTimeString() : '--'}</span>
                <span className={cam.error ? 'text-amber-300' : 'text-emerald-300'}>
                  {cam.error ? 'error' : cam.inflight ? 'inference' : 'ok'}
                </span>
              </div>
            ))
          ) : (
            <div className="text-slate-400">No camera state yet.</div>
          )}
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="panel-muted text-xs uppercase">Recent Events</div>
        <div className="surface max-h-40 overflow-y-auto text-xs text-slate-200">
          {history.length ? (
            history
              .slice()
              .reverse()
              .map((entry, idx) => (
                <div key={`${entry.ts}-${entry.type}-${idx}`} className="flex items-start justify-between gap-0.5">
                  <span>{entry.type}</span>
                  <span className="text-slate-400">{entry.ts ? new Date(entry.ts).toLocaleTimeString() : '--'}</span>
                </div>
              ))
          ) : (
            <div className="text-slate-400">No events yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function LlmCommentaryPanel({ state, onClearHistory, clearingHistory }) {
  const [selectedRunId, setSelectedRunId] = useState(null);
  if (!state) {
    return (
      <div className="space-y-0.5">
        <div className="panel-muted text-xs uppercase">LLM Commentary</div>
        <div className="surface text-xs text-slate-300">No status received yet.</div>
      </div>
    );
  }
  const runtime = state.runtime || {};
  const counters = state.counters || {};
  const timings = state.timings || {};
  const input = state.input || {};
  const output = state.output || {};
  const errors = state.errors || {};
  const history = Array.isArray(state.history) ? state.history : [];
  const selectedRun =
    history.find((run) => run.runId === selectedRunId) || (history.length ? history[history.length - 1] : null);
  const largeIndicator = buildLlmLargeIndicatorFromState(state);
  const conversationRows = buildLlmConversationRowsFromMessages(input.modelMessages, output.raw);
  const statPills = [
    { label: 'running', value: runtime.running ? 'yes' : 'no' },
    { label: 'in flight', value: runtime.inFlight ? 'yes' : 'no' },
    { label: 'phase', value: runtime.phase || '--' },
    { label: 'run id', value: runtime.currentRunId ?? '--' },
    { label: 'tick count', value: runtime.tickCount ?? 0 },
    {
      label: 'last tick',
      value: runtime.lastTickAt ? new Date(runtime.lastTickAt).toLocaleString() : 'never',
    },
    {
      label: 'next run',
      value: runtime.nextRunAt ? new Date(runtime.nextRunAt).toLocaleString() : 'n/a',
    },
    { label: 'outcome', value: runtime.outcome || '--' },
    { label: 'reason', value: runtime.reason || '--' },
    { label: 'skip streak', value: counters.skipStreak ?? 0 },
    { label: 'clear count', value: counters.clearCount ?? 0 },
    { label: 'last gen', value: timings.lastGenerationMs != null ? `${timings.lastGenerationMs} ms` : '--' },
    { label: 'avg gen', value: timings.avgGenerationMs != null ? `${timings.avgGenerationMs} ms` : '--' },
    { label: 'gen count', value: timings.generationCount ?? 0 },
    { label: 'prompt chars', value: counters.promptChars ?? 0 },
    { label: 'active drivers', value: counters.snapshotSummary?.activeDrivers ?? 0 },
    { label: 'snapshot rovers', value: counters.snapshotSummary?.rovers ?? 0 },
    { label: 'snapshot chat', value: counters.snapshotSummary?.chatMessages ?? 0 },
  ];

  return (
    <div className="space-y-0.5">
      <div className="panel-muted text-xs uppercase">LLM Commentary</div>
      <div className="flex gap-0.5 text-xs">
        <button
          type="button"
          onClick={onClearHistory}
          disabled={Boolean(clearingHistory)}
          className="button-danger disabled:cursor-not-allowed disabled:opacity-60"
        >
          {clearingHistory ? 'Clearing...' : 'Clear LLM History'}
        </button>
      </div>
      <div className={`surface border text-center ${largeIndicator.className}`}>
        <div className="text-[1.1rem] font-bold tracking-wide">{largeIndicator.label}</div>
        <div className="text-xs text-slate-200">{largeIndicator.detail}</div>
      </div>
      <div className="surface flex flex-wrap gap-0.5 text-xs">
        {statPills.map((pill) => (
          <span
            key={pill.label}
            className="rounded border border-slate-600/60 bg-slate-800/70 px-0.5 py-0.25 text-[0.72rem] leading-tight text-slate-200"
          >
            {pill.label}: {pill.value}
          </span>
        ))}
      </div>
      {errors.message ? (
        <div className="surface text-xs text-red-300 break-words">
          Error: {errors.message}
        </div>
      ) : null}
      {errors.details ? (
        <details className="surface text-xs text-red-200">
          <summary className="cursor-pointer select-none text-red-300">Failure details</summary>
          <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-red-200">
            {JSON.stringify(errors.details, null, 2)}
          </pre>
        </details>
      ) : null}
      {output.generated ? (
        <div className="surface text-xs text-slate-200 break-words">
          Generated: {output.generated}
        </div>
      ) : null}
      {output.posted ? (
        <div className="surface text-xs text-emerald-200 break-words">
          Posted: {output.posted}
        </div>
      ) : null}
      <div className="grid gap-0.5 md:grid-cols-2">
        <div className="space-y-0.5">
          <div className="panel-muted text-xs uppercase">Live Input Conversation</div>
          <div className="surface max-h-72 space-y-0.5 overflow-y-auto">
            {conversationRows.length ? (
              conversationRows.map((row) => <ChatMessageRow key={row.id} message={row.message} />)
            ) : (
              <div className="text-xs text-slate-300">No model conversation captured yet.</div>
            )}
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="panel-muted text-xs uppercase">Output + Error</div>
          <div className="surface space-y-0.5 text-xs text-slate-200">
            <div>Raw output: {output.raw?.trim() ? output.raw : '<none>'}</div>
            <div>Posted: {output.posted || '<none>'}</div>
            <div>
              Output at:{' '}
              {output.modelOutputAt ? new Date(output.modelOutputAt).toLocaleString() : 'n/a'}
            </div>
            <div>
              Failed at: {errors.failedAt ? new Date(errors.failedAt).toLocaleString() : 'n/a'}
            </div>
          </div>
        </div>
      </div>
      <details className="surface text-xs text-slate-200">
        <summary className="cursor-pointer select-none text-slate-300">Full Monitor Payload</summary>
        <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-slate-200">
          {JSON.stringify(state, null, 2)}
        </pre>
      </details>
      <div className="space-y-0.5">
        <div className="panel-muted text-xs uppercase">Recent Runs</div>
        <div className="surface max-h-52 space-y-0.5 overflow-y-auto text-xs">
          {history.length ? (
            history
              .slice()
              .reverse()
              .map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => setSelectedRunId(run.runId)}
                  className={`w-full text-left surface ${
                    selectedRun?.runId === run.runId ? 'border border-sky-400/50' : ''
                  }`}
                >
                  <span className="text-slate-300">#{run.runId}</span>{' '}
                  <span className="text-slate-200">{run.outcome || run.phase || '--'}</span>{' '}
                  <span className="text-slate-400">{run.durationMs != null ? `${run.durationMs}ms` : '--'}</span>{' '}
                  <span className="text-slate-500">{run.reason || ''}</span>
                </button>
              ))
          ) : (
            <div className="text-slate-300">No runs recorded yet.</div>
          )}
        </div>
      </div>
      {selectedRun ? (
        <details className="surface text-xs text-slate-200" open>
          <summary className="cursor-pointer select-none text-slate-300">
            Run #{selectedRun.runId} details
          </summary>
          <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-slate-200">
            {JSON.stringify(selectedRun, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function buildLlmLargeIndicatorFromState(state) {
  const runtime = state?.runtime || {};
  const output = state?.output || {};
  const errors = state?.errors || {};
  if (runtime.inFlight) {
    return {
      label: 'IN FLIGHT',
      detail: runtime.reason || 'Generating commentary now',
      className: 'border-amber-400/60 bg-amber-700/20 text-amber-200',
    };
  }
  if (runtime.outcome === 'posted') {
    return {
      label: 'POSTED',
      detail: output.posted ? `Last: ${output.posted}` : 'Commentary posted',
      className: 'border-emerald-400/60 bg-emerald-700/20 text-emerald-200',
    };
  }
  if (runtime.outcome === 'skipped') {
    return {
      label: 'SKIPPED',
      detail: runtime.reason || 'Model chose to skip',
      className: 'border-slate-400/60 bg-slate-700/30 text-slate-200',
    };
  }
  if (runtime.outcome === 'failed') {
    return {
      label: 'FAILED',
      detail: errors.message || runtime.reason || 'Tick failed',
      className: 'border-red-400/60 bg-red-700/20 text-red-200',
    };
  }
  return {
    label: runtime.running ? 'IDLE' : 'STOPPED',
    detail: runtime.reason || 'Waiting for next tick',
    className: 'border-sky-400/50 bg-sky-700/20 text-sky-200',
  };
}

function buildLlmConversationRowsFromMessages(modelMessages, rawOutput) {
  const now = Date.now();
  const messages = Array.isArray(modelMessages) ? modelMessages : [];
  const rows = messages.map((entry, index) => {
    const role = String(entry?.role || '').toLowerCase();
    const content =
      typeof entry?.content === 'string' ? entry.content : JSON.stringify(entry?.content ?? null, null, 2);
    const nickname =
      role === 'system'
        ? 'LLM System'
        : role === 'assistant'
        ? 'LLM Context'
        : role === 'user'
        ? 'LLM Input'
        : 'LLM Message';
    return {
      id: `llm-msg-${index}`,
      message: {
        ts: now + index,
        nickname,
        text: content,
        role: 'spectator',
        system: role === 'system',
      },
    };
  });
  if (rawOutput != null) {
    const raw = String(rawOutput);
    rows.push({
      id: 'llm-output',
      message: {
        ts: now + rows.length + 1,
        nickname: 'LLM Output',
        text: raw.trim() ? raw : '<empty>',
        role: 'spectator',
        system: true,
      },
    });
  }
  return rows;
}

function ReplaySnapshotHealth({ health, roster = [] }) {
  if (!health) return null;
  const replay = health.replay || { sources: [], readyCount: 0, totalCount: 0 };
  const snapshots = health.snapshots || { rovers: [], rooms: [] };
  const roverColorFor = (id) =>
    roster.find((entry) => String(entry.id) === String(id))?.color || null;
  const replaySummary = `${replay.readyCount}/${replay.totalCount} sources ready`;
  const roverStale = snapshots.rovers.filter((entry) => entry.stale).length;
  const roomStale = snapshots.rooms.filter((entry) => entry.stale).length;
  return (
    <div className="space-y-0.5">
      <div className="panel-muted text-xs uppercase">Health</div>
      <div className="surface space-y-0.5 text-xs text-slate-200">
        <div className="flex items-center justify-between">
          <span>Replay segments</span>
          <span className="text-slate-400">{replaySummary}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Rover snapshots</span>
          <span className={roverStale ? 'text-amber-300' : 'text-emerald-300'}>
            {snapshots.rovers.length - roverStale}/{snapshots.rovers.length} ok
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Room cameras</span>
          <span className={roomStale ? 'text-amber-300' : 'text-emerald-300'}>
            {snapshots.rooms.length - roomStale}/{snapshots.rooms.length} ok
          </span>
        </div>
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">
        {replay.sources.map((source) => (
          <div key={`${source.type}:${source.id}`} className="flex items-center justify-between">
            <span
              className={`${source.type === 'rover' ? 'rounded px-1 py-[1px] border border-transparent' : ''}`}
              style={
                source.type === 'rover'
                  ? roverNameChromeStyle(roverColorFor(source.id), 0.16)
                  : undefined
              }
            >
              {source.label}
            </span>
            <span className={source.ready ? 'text-emerald-300' : 'text-amber-300'}>
              {source.recentCount}/{source.neededCount}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">
        {snapshots.rovers.map((entry) => (
          <div key={`rover:${entry.id}`} className="flex items-center justify-between">
            <span
              className="rounded px-1 py-[1px] border border-transparent"
              style={roverNameChromeStyle(roverColorFor(entry.id), 0.16)}
            >
              {entry.name}
            </span>
            <span className={entry.stale ? 'text-amber-300' : 'text-emerald-300'}>
              {entry.stale ? 'stale' : 'ok'}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">
        {snapshots.rooms.map((entry) => (
          <div key={`room:${entry.id}`} className="flex items-center justify-between">
            <span>{entry.name}</span>
            <span className={entry.stale ? 'text-amber-300' : 'text-emerald-300'}>
              {entry.error ? 'error' : entry.stale ? 'stale' : 'ok'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminIpLogPanel({ entries }) {
  const logs = entries || [];
  return (
    <div className="panel-section space-y-0.5 text-base">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>Admin IP log</span>
        <span>{logs.length}</span>
      </div>
      <div className="surface h-64 overflow-y-auto font-mono text-xs">
        {logs.length === 0 ? (
          <p>No admin log entries yet.</p>
        ) : (
          logs
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} className="surface">
                <span className="text-amber-400">
                  {entry.ts ? new Date(entry.ts).toLocaleTimeString() : '--'}
                </span>{' '}
                {entry.label && <span className="text-teal-400">[{entry.label}]</span>}{' '}
                <span className="text-slate-200">{entry.message}</span>{' '}
                {entry.ip && <span className="text-cyan-300">{entry.ip}</span>}{' '}
                {entry.meta && <span className="text-slate-500">{JSON.stringify(entry.meta)}</span>}
              </div>
            ))
        )}
      </div>
      <p className="text-xs text-slate-500">Admin-only log stream; IPs never appear in user data.</p>
    </div>
  );
}
