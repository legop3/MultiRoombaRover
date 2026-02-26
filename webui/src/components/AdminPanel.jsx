import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import RoverRoster from './RoverRoster.jsx';
import ChatMessageRow from './ChatMessageRow.jsx';

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
    llmControl,
    adminLogs,
    llmCommentaryStatus,
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

  const isAdmin =
    session?.role === 'admin' ||
    session?.role === 'lockdown' ||
    session?.role === 'lockdown-admin';

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

  useEffect(() => {
    setGoalDraft(currentGoal);
  }, [currentGoal]);

  useEffect(() => {
    setReasonDraft(currentReason);
  }, [currentReason]);

  const lockMap = useMemo(() => {
    const map = {};
    roster.forEach((rover) => {
      map[rover.id] = lockStates[rover.id] ?? rover.locked;
    });
    return map;
  }, [roster, lockStates]);

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
          <div className="flex flex-wrap gap-0.5 text-xs">
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
          </div>
        )}
      />
      <ReplaySnapshotHealth health={health} />
      <LlmCommentaryPanel
        status={llmCommentaryStatus}
        onClearHistory={handleClearLlmHistory}
        clearingHistory={clearingLlmHistory}
      />
      <AdminIpLogPanel entries={adminLogs} />
    </section>
  );
}

function LlmCommentaryPanel({ status, onClearHistory, clearingHistory }) {
  if (!status) {
    return (
      <div className="space-y-0.5">
        <div className="panel-muted text-xs uppercase">LLM Commentary</div>
        <div className="surface text-xs text-slate-300">No status received yet.</div>
      </div>
    );
  }

  const lastTickAt = status.lastTickAt ? new Date(status.lastTickAt).toLocaleString() : 'never';
  const nextRunAt = status.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : 'n/a';
  const lastPostedAt = status.lastPostedAt ? new Date(status.lastPostedAt).toLocaleString() : 'never';
  const summary = status.lastSnapshotSummary || {};
  const statusColor =
    status.lastOutcome === 'failed'
      ? 'text-red-300'
      : status.lastOutcome === 'posted'
      ? 'text-emerald-300'
      : 'text-slate-300';
  const largeIndicator = buildLlmLargeIndicator(status);
  const conversationRows = buildLlmConversationRows(status);
  const statPills = [
    { label: 'enabled', value: status.enabled ? 'yes' : 'no' },
    { label: 'running', value: status.running ? 'yes' : 'no' },
    { label: 'in flight', value: status.inFlight ? 'yes' : 'no' },
    { label: 'model', value: status.model || '--' },
    { label: 'server', value: status.ollamaUrl || '--' },
    { label: 'frequency', value: `${status.frequencyMs} ms` },
    { label: 'tick count', value: status.tickCount ?? 0 },
    { label: 'skip streak', value: status.skipStreak ?? 0 },
    { label: 'last gen', value: status.lastGenerationMs != null ? `${status.lastGenerationMs} ms` : '--' },
    { label: 'avg gen', value: status.avgGenerationMs != null ? `${status.avgGenerationMs} ms` : '--' },
    { label: 'gen count', value: status.generationCount ?? 0 },
    { label: 'last outcome', value: status.lastOutcome || '--' },
    { label: 'last reason', value: status.lastReason || '--' },
    { label: 'last tick', value: lastTickAt },
    { label: 'next run', value: nextRunAt },
    { label: 'last posted', value: lastPostedAt },
    { label: 'prompt chars', value: status.lastPromptChars ?? 0 },
    { label: 'cleared count', value: status.clearCount ?? 0 },
    {
      label: 'last cleared',
      value: status.lastClearedAt ? new Date(status.lastClearedAt).toLocaleString() : 'never',
    },
    { label: 'snapshot active drivers', value: summary.activeDrivers ?? 0 },
    { label: 'snapshot rovers', value: summary.rovers ?? 0 },
    { label: 'snapshot chat msgs', value: summary.chatMessages ?? 0 },
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
            className={`rounded border px-0.5 py-0.25 text-[0.72rem] leading-tight ${
              pill.label === 'last outcome'
                ? `${statusColor} border-slate-500/40 bg-slate-800/70`
                : 'border-slate-600/60 bg-slate-800/70 text-slate-200'
            }`}
          >
            {pill.label}: {pill.value}
          </span>
        ))}
      </div>
      {status.lastError ? (
        <div className="surface text-xs text-red-300 break-words">
          Error: {status.lastError}
        </div>
      ) : null}
      {status.lastErrorDetails ? (
        <details className="surface text-xs text-red-200">
          <summary className="cursor-pointer select-none text-red-300">Failure details</summary>
          <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-red-200">
            {JSON.stringify(status.lastErrorDetails, null, 2)}
          </pre>
        </details>
      ) : null}
      {status.lastGeneratedText ? (
        <div className="surface text-xs text-slate-200 break-words">
          Generated: {status.lastGeneratedText}
        </div>
      ) : null}
      {status.lastPostedText ? (
        <div className="surface text-xs text-emerald-200 break-words">
          Posted: {status.lastPostedText}
        </div>
      ) : null}
      <details className="surface text-xs text-slate-200">
        <summary className="cursor-pointer select-none text-slate-300">Most recent system prompt</summary>
        <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-slate-200">
          {status.lastSystemPrompt || 'No prompt read yet.'}
        </pre>
      </details>
      <details className="surface text-xs text-slate-200">
        <summary className="cursor-pointer select-none text-slate-300">Most recent info snapshot</summary>
        <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-slate-200">
          {status.lastInfoSnapshot
            ? JSON.stringify(status.lastInfoSnapshot, null, 2)
            : 'No snapshot captured yet.'}
        </pre>
      </details>
      <div className="space-y-0.5">
        <div className="panel-muted text-xs uppercase">Most recent LLM conversation</div>
        <div className="surface max-h-72 space-y-0.5 overflow-y-auto">
          {conversationRows.length ? (
            conversationRows.map((row) => <ChatMessageRow key={row.id} message={row.message} />)
          ) : (
            <div className="text-xs text-slate-300">No model conversation captured yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildLlmLargeIndicator(status) {
  if (status?.inFlight) {
    return {
      label: 'IN FLIGHT',
      detail: 'Generating commentary now',
      className: 'border-amber-400/60 bg-amber-700/20 text-amber-200',
    };
  }
  if (status?.lastOutcome === 'posted') {
    return {
      label: 'POSTED',
      detail: status?.lastPostedText ? `Last: ${status.lastPostedText}` : 'Commentary posted',
      className: 'border-emerald-400/60 bg-emerald-700/20 text-emerald-200',
    };
  }
  if (status?.lastOutcome === 'skipped') {
    return {
      label: 'SKIPPED',
      detail: status?.lastReason || 'Model chose to skip',
      className: 'border-slate-400/60 bg-slate-700/30 text-slate-200',
    };
  }
  if (status?.lastOutcome === 'failed') {
    return {
      label: 'FAILED',
      detail: status?.lastError || status?.lastReason || 'Tick failed',
      className: 'border-red-400/60 bg-red-700/20 text-red-200',
    };
  }
  return {
    label: status?.running ? 'IDLE' : 'STOPPED',
    detail: status?.lastReason || 'Waiting for next tick',
    className: 'border-sky-400/50 bg-sky-700/20 text-sky-200',
  };
}

function buildLlmConversationRows(status) {
  const now = Date.now();
  const modelMessages = Array.isArray(status?.lastModelMessages) ? status.lastModelMessages : [];
  const rows = modelMessages.map((entry, index) => {
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
  if (status?.lastModelRawOutput != null) {
    const raw = String(status.lastModelRawOutput);
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

function ReplaySnapshotHealth({ health }) {
  if (!health) return null;
  const replay = health.replay || { sources: [], readyCount: 0, totalCount: 0 };
  const snapshots = health.snapshots || { rovers: [], rooms: [] };
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
            <span>{source.label}</span>
            <span className={source.ready ? 'text-emerald-300' : 'text-amber-300'}>
              {source.recentCount}/{source.neededCount}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">
        {snapshots.rovers.map((entry) => (
          <div key={`rover:${entry.id}`} className="flex items-center justify-between">
            <span>{entry.name}</span>
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
