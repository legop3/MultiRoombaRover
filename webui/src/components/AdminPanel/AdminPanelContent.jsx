// Admin Panel Content
// Purpose: Defines the Admin Panel Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../context/SessionContext.jsx';
import RoverRoster from '../RoverRoster/index.jsx';
import LlmCommentaryPanel from './LlmCommentaryPanel.jsx';
import OverseerControlPanel from './OverseerControlPanel.jsx';
import ReplaySnapshotHealth from './ReplaySnapshotHealth.jsx';
import AdminIpLogPanel from './AdminIpLogPanel.jsx';
import CardFrame from '../CardFrame/index.jsx';
import { trackAnalyticsEvent } from '../../analytics/index.js';

const MODES = [
  { key: 'open', label: 'Open' },
  { key: 'turns', label: 'Turns' },
  { key: 'admin', label: 'Admin' },
  { key: 'lockdown', label: 'Lockdown' },
];

/*
  The same three gain keys drive both the global levels and the VIP boost hard
  caps, so both editors render from one list instead of six copied sliders.
*/
const GAIN_FIELDS = [
  { key: 'hornGain', label: 'Horn gain' },
  { key: 'ttsGain', label: 'TTS gain' },
  { key: 'forwardGain', label: 'Forward gain' },
];

function normalizeGainDraft(source, fallback) {
  const draft = {};
  GAIN_FIELDS.forEach(({ key }) => {
    draft[key] = Number.isFinite(source?.[key]) ? source[key] : fallback[key];
  });
  return draft;
}

function GainSlider({ label, value, onChange }) {
  return (
    <label className="grid gap-0.5 text-xs text-slate-200">
      <div className="flex items-center justify-between gap-0.5">
        <span>{label}</span>
        <span>{Number(value).toFixed(2)}x</span>
      </div>
      <input
        type="range"
        min="0"
        max="4"
        step="0.01"
        value={value}
        onChange={onChange}
        className="w-full accent-emerald-500"
      />
    </label>
  );
}

function buildPrivateSafetyDraft(rover) {
  const safety = rover?.private?.safety || {};
  return {
    speedLimitEnabled: Boolean(safety.speedLimitEnabled),
    speedLimitMaxWheelSpeed: Number.isFinite(safety.speedLimitMaxWheelSpeed)
      ? safety.speedLimitMaxWheelSpeed
      : 250,
    hardOvercurrentEnabled: Boolean(safety.hardOvercurrentEnabled),
    overcurrentStopMs: Number.isFinite(safety.overcurrentStopMs)
      ? safety.overcurrentStopMs
      : 300,
    hardBumpEnabled: Boolean(safety.hardBumpEnabled),
    bumpBackoffSpeed: Number.isFinite(safety.bumpBackoffSpeed)
      ? safety.bumpBackoffSpeed
      : 250,
    bumpBackoffMs: Number.isFinite(safety.bumpBackoffMs)
      ? safety.bumpBackoffMs
      : 350,
    cliffEnabled: Boolean(safety.cliffEnabled),
    cliffBackoffSpeed: Number.isFinite(safety.cliffBackoffSpeed)
      ? safety.cliffBackoffSpeed
      : 250,
    cliffBackoffMs: Number.isFinite(safety.cliffBackoffMs)
      ? safety.cliffBackoffMs
      : 500,
    // Virtual wall is default-on for private rovers. Older rover hellos will
    // not include this field, so the admin form mirrors the server default
    // instead of rendering an unchecked box that would accidentally disable it.
    virtualWallEnabled: safety.virtualWallEnabled == null ? true : Boolean(safety.virtualWallEnabled),
    virtualWallBackoffSpeed: Number.isFinite(safety.virtualWallBackoffSpeed)
      ? safety.virtualWallBackoffSpeed
      : 250,
    virtualWallBackoffMs: Number.isFinite(safety.virtualWallBackoffMs)
      ? safety.virtualWallBackoffMs
      : 500,
    triggerCooldownMs: Number.isFinite(safety.triggerCooldownMs)
      ? safety.triggerCooldownMs
      : 800,
  };
}

export default function AdminPanelContent() {
  const {
    session,
    lockRover,
    setMode,
    requestControl,
    setGlobalObjective,
    setAdminReason,
    rebootRover,
    updateRover,
    updateAllRovers,
    rebootServer,
    setAudioLevels,
    setUserAudioGainCaps,
    setPrivateSafety,
    llmControl,
    overseerControl,
    adminLogs,
    llmCommentaryState,
    overseerControlState,
  } = useSession();
  const roster = useMemo(() => session?.roster ?? [], [session?.roster]);
  const [lockStates, setLockStates] = useState({});
  const [rebootStates, setRebootStates] = useState({});
  const [updateStates, setUpdateStates] = useState({});
  const [serverRebooting, setServerRebooting] = useState(false);
  const [clearingLlmHistory, setClearingLlmHistory] = useState(false);
  const [clearingOverseerHistory, setClearingOverseerHistory] = useState(false);
  const health = session?.health || null;
  const currentGoal = session?.globalObjective?.text || '';
  const goalUpdatedAt = session?.globalObjective?.updatedAt || null;
  const [goalDraft, setGoalDraft] = useState(currentGoal);
  const currentReason = session?.adminReason?.text || '';
  const reasonUpdatedAt = session?.adminReason?.updatedAt || null;
  const [reasonDraft, setReasonDraft] = useState(currentReason);
  const currentAudioLevels = session?.audioLevels || {};
  const currentUserGainCaps = currentAudioLevels.userGainCaps || {};
  const [audioLevelDraft, setAudioLevelDraft] = useState(
    () => normalizeGainDraft(currentAudioLevels, { hornGain: 1, ttsGain: 1, forwardGain: 1 }),
  );
  const [userGainCapDraft, setUserGainCapDraft] = useState(
    () => normalizeGainDraft(currentUserGainCaps, { hornGain: 0.5, ttsGain: 0.8, forwardGain: 0.4 }),
  );
  const [privateSafetyDrafts, setPrivateSafetyDrafts] = useState({});
  const [privateSafetyDirty, setPrivateSafetyDirty] = useState({});

  const isAdmin =
    session?.role === 'admin' ||
    session?.role === 'lockdown';
  const isLockdownAdmin = session?.role === 'lockdown';

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
    trackAnalyticsEvent('admin_mode_change', { mode, status: 'started' });
    try {
      await setMode(mode);
      trackAnalyticsEvent('admin_mode_change', { mode, status: 'accepted' });
    } catch (err) {
      trackAnalyticsEvent('admin_mode_change', { mode, status: 'failed', reason: err?.message || 'unknown' });
      alert(err.message);
    }
  };

  const handleForceControl = async (roverId) => {
    trackAnalyticsEvent('admin_force_control', { roverId, status: 'started' });
    try {
      await requestControl(roverId, { force: true });
      trackAnalyticsEvent('admin_force_control', { roverId, status: 'accepted' });
    } catch (err) {
      trackAnalyticsEvent('admin_force_control', { roverId, status: 'failed', reason: err?.message || 'unknown' });
      alert(err.message);
    }
  };

  const handleReboot = async (rover) => {
    if (!rover?.id) return;
    const ok = window.confirm(`Reboot rover "${rover.name || rover.id}" now?`);
    if (!ok) return;
    setRebootStates((prev) => ({ ...prev, [rover.id]: true }));
    trackAnalyticsEvent('rover_reboot_click', { roverId: rover.id, scope: 'admin' });
    try {
      await rebootRover(rover.id);
      trackAnalyticsEvent('rover_reboot_result', { roverId: rover.id, scope: 'admin', status: 'accepted' });
    } catch (err) {
      trackAnalyticsEvent('rover_reboot_result', { roverId: rover.id, scope: 'admin', status: 'failed', reason: err?.message || 'unknown' });
      alert(err.message);
    } finally {
      setRebootStates((prev) => ({ ...prev, [rover.id]: false }));
    }
  };

  const handleUpdate = async (rover) => {
    if (!rover?.id) return;
    const ok = window.confirm(
      `Update rover "${rover.name || rover.id}" now? The rover will git pull the repo, run the roverd installer, and may disconnect while services restart.`,
    );
    if (!ok) return;
    setUpdateStates((prev) => ({ ...prev, [rover.id]: true }));
    trackAnalyticsEvent('rover_update_click', { roverId: rover.id });
    try {
      // The rover acknowledges once the privileged self-update helper has been
      // launched, not when the full install finishes. That is deliberate: a
      // successful installer run restarts roverd, so waiting for completion over
      // the same websocket would make the button look failed even when the
      // update is doing exactly what it should.
      await updateRover(rover.id);
      trackAnalyticsEvent('rover_update_result', { roverId: rover.id, status: 'accepted' });
    } catch (err) {
      trackAnalyticsEvent('rover_update_result', { roverId: rover.id, status: 'failed', reason: err?.message || 'unknown' });
      alert(err.message);
    } finally {
      setUpdateStates((prev) => ({ ...prev, [rover.id]: false }));
    }
  };

  const handleUpdateAll = async () => {
    const roverCount = roster.filter((rover) => rover?.id).length;
    if (roverCount === 0) return;

    const ok = window.confirm(
      `Update all ${roverCount} rover${roverCount === 1 ? '' : 's'} now? Each rover will run its self-update and reboot if the update starts successfully.`,
    );
    if (!ok) return;

    trackAnalyticsEvent('rover_update_all_click', { roverCount });
    try {
      // The server owns the fan-out because it has the authoritative online
      // rover map and can enforce admin privileges once before issuing the
      // existing per-rover update command to every connected rover.
      const result = await updateAllRovers();
      trackAnalyticsEvent('rover_update_all_result', {
        status: 'accepted',
        updated: result?.updated?.length || 0,
        failed: result?.failed?.length || 0,
      });
      if (result?.failed?.length) {
        alert(`Update requested for ${result.updated?.length || 0} rover(s). ${result.failed.length} rover(s) failed to queue.`);
      }
    } catch (err) {
      trackAnalyticsEvent('rover_update_all_result', { status: 'failed', reason: err?.message || 'unknown' });
      alert(err.message);
    }
  };

  const handleServerReboot = async () => {
    const ok = window.confirm('Reboot the server host now? This will disconnect all users.');
    if (!ok) return;
    setServerRebooting(true);
    trackAnalyticsEvent('server_reboot_click', { status: 'started' });
    try {
      await rebootServer();
      trackAnalyticsEvent('server_reboot_click', { status: 'accepted' });
    } catch (err) {
      trackAnalyticsEvent('server_reboot_click', { status: 'failed', reason: err?.message || 'unknown' });
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

  const handleClearOverseerHistory = async () => {
    const ok = window.confirm('Clear Overseer Control history now?');
    if (!ok) return;
    setClearingOverseerHistory(true);
    try {
      await overseerControl('clearHistory');
    } catch (err) {
      alert(err.message);
    } finally {
      setClearingOverseerHistory(false);
    }
  };

  const handleGoalSave = async () => {
    try {
      await setGlobalObjective(goalDraft);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleGoalClear = async () => {
    try {
      await setGlobalObjective(null);
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

  const handleUserGainCapDraft = (key) => (event) => {
    const next = Number(event.target.value);
    setUserGainCapDraft((current) => ({ ...(current || {}), [key]: Number.isFinite(next) ? next : 0 }));
  };

  const handleUserGainCapsSave = async () => {
    try {
      await setUserAudioGainCaps(userGainCapDraft);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleTestRewardOverlay = async () => {
    window.dispatchEvent(
      new CustomEvent('buttonBox:rewardRunLocalTest', {
        detail: {
          rewardName: 'Admin Mode',
          count: 1000,
          goal: 1000,
        },
      }),
    );
  };

  useEffect(() => {
    setGoalDraft(currentGoal);
  }, [currentGoal]);

  useEffect(() => {
    setReasonDraft(currentReason);
  }, [currentReason]);

  useEffect(() => {
    setAudioLevelDraft(normalizeGainDraft(currentAudioLevels, { hornGain: 1, ttsGain: 1, forwardGain: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAudioLevels.forwardGain, currentAudioLevels.hornGain, currentAudioLevels.ttsGain]);

  useEffect(() => {
    setUserGainCapDraft(normalizeGainDraft(currentUserGainCaps, { hornGain: 0.5, ttsGain: 0.8, forwardGain: 0.4 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserGainCaps.forwardGain, currentUserGainCaps.hornGain, currentUserGainCaps.ttsGain]);


  useEffect(() => {
    setPrivateSafetyDrafts((currentDrafts) => {
      const next = {};
      (roster || []).forEach((rover) => {
        if (!rover?.private?.enabled) return;
        // Session syncs can arrive while an admin is focused in one of these
        // inputs. Preserve that rover's local draft once touched; otherwise the
        // server roster remains the source of truth for newly connected rovers
        // and for rovers whose form is not being edited.
        next[rover.id] = privateSafetyDirty?.[rover.id]
          ? currentDrafts?.[rover.id] || buildPrivateSafetyDraft(rover)
          : buildPrivateSafetyDraft(rover);
      });
      return next;
    });
  }, [privateSafetyDirty, roster]);

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
    // Mark the whole rover draft dirty rather than individual fields. The form
    // is saved as one object, so protecting it as one unit avoids partial
    // server refreshes that mix old roster values with the user's unsaved edit.
    setPrivateSafetyDirty((current) => ({ ...(current || {}), [roverId]: true }));
  };

  const handlePrivateSafetySave = async (roverId) => {
    try {
      const draft = privateSafetyDrafts?.[roverId];
      if (!draft) return;
      const resp = await setPrivateSafety(roverId, draft);
      if (resp?.safety) {
        setPrivateSafetyDrafts((current) => ({ ...(current || {}), [roverId]: resp.safety }));
      }
      setPrivateSafetyDirty((current) => {
        const next = { ...(current || {}) };
        delete next[roverId];
        return next;
      });
    } catch (err) {
      alert(err.message);
    }
  };

  if (!isAdmin) return null;

  const actions = (
        <select value={currentMode} onChange={handleModeChange} className="field-input text-sm">
          {MODES.map((mode) => (
            <option key={mode.key} value={mode.key}>
              {mode.label}
            </option>
          ))}
        </select>
  );

  return (
    <CardFrame title="Admin controls" actions={actions} bodyClassName="space-y-0.5 text-base">
      <div className="flex gap-0.5 text-xs">
        <button
          type="button"
          onClick={handleServerReboot}
          disabled={serverRebooting}
          className="button-danger disabled:cursor-not-allowed disabled:opacity-60"
        >
          {serverRebooting ? 'Server rebooting...' : 'Reboot Server'}
        </button>
        <button
          type="button"
          onClick={handleTestRewardOverlay}
          className="button-dark"
        >
          Test Reward Popup
        </button>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Global audio levels</span>
          {session?.audioLevels?.updatedAt ? (
            <span>Updated {new Date(session.audioLevels.updatedAt).toLocaleString()}</span>
          ) : null}
        </div>
        {GAIN_FIELDS.map(({ key, label }) => (
          <GainSlider
            key={key}
            label={label}
            value={audioLevelDraft[key]}
            onChange={handleAudioLevelDraft(key)}
          />
        ))}
        <p className="text-xs text-slate-500">
          These are the volume ceilings for ordinary users. Each user picks a 0-100% share of them.
        </p>
        <div className="flex gap-0.5 text-xs">
          <button type="button" onClick={handleAudioLevelsSave} className="button-dark">
            Apply audio levels
          </button>
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>VIP gain boost hard caps</span>
          {session?.audioLevels?.capsUpdatedAt ? (
            <span>Updated {new Date(session.audioLevels.capsUpdatedAt).toLocaleString()}</span>
          ) : null}
        </div>
        {GAIN_FIELDS.map(({ key, label }) => (
          <GainSlider
            key={key}
            label={label}
            value={userGainCapDraft[key]}
            onChange={handleUserGainCapDraft(key)}
          />
        ))}
        <p className="text-xs text-slate-500">
          Ceilings for VIPs granted the boost with <code>rs gain grant &lt;vip&gt;</code>. A boost never lowers
          someone&apos;s limit, so a cap below the global gain above has no effect.
        </p>
        <div className="flex gap-0.5 text-xs">
          <button type="button" onClick={handleUserGainCapsSave} className="button-dark">
            Apply boost caps
          </button>
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Global objective</span>
          {goalUpdatedAt ? (
            <span>Updated {new Date(goalUpdatedAt).toLocaleString()}</span>
          ) : null}
        </div>
        <input
          type="text"
          value={goalDraft}
          onChange={(event) => setGoalDraft(event.target.value)}
          placeholder="Set a global objective"
          className="field-input text-sm"
        />
        <div className="flex gap-0.5 text-xs">
          <button type="button" onClick={handleGoalSave} className="button-dark">
            Set objective
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

      <div className="flex items-center justify-between gap-0.5 text-xs">
        <span className="text-slate-400">Rovers</span>
        <button
          type="button"
          onClick={handleUpdateAll}
          disabled={roster.length === 0}
          className="button-danger disabled:cursor-not-allowed disabled:opacity-60"
        >
          Update All
        </button>
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
            <button
              type="button"
              onClick={() => handleUpdate(rover)}
              disabled={Boolean(updateStates[rover.id])}
              className="button-danger disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateStates[rover.id] ? 'Updating...' : 'Update'}
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
                <label className="flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={Boolean(privateSafetyDrafts?.[rover.id]?.virtualWallEnabled)}
                    disabled={!isLockdownAdmin}
                    onChange={(event) =>
                      updatePrivateSafetyDraft(rover.id, { virtualWallEnabled: Boolean(event.target.checked) })}
                  />
                  <span>Virtual wall</span>
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
      <LlmCommentaryPanel
        state={llmCommentaryState}
        onClearHistory={handleClearLlmHistory}
        clearingHistory={clearingLlmHistory}
      />
      <OverseerControlPanel
        state={overseerControlState}
        onClearHistory={handleClearOverseerHistory}
        clearingHistory={clearingOverseerHistory}
      />
      <AdminIpLogPanel entries={adminLogs} />
    </CardFrame>
  );
}
