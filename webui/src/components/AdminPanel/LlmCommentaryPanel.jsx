// Llm Commentary Panel
// Purpose: Defines the Llm Commentary Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useState } from 'react';
import ChatMessageRow from '../ChatMessageRow/index.jsx';
import { buildLlmLargeIndicatorFromState, buildLlmConversationRowsFromMessages } from './llmHelpers.js';

export default function LlmCommentaryPanel({ state, onClearHistory, clearingHistory }) {
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
        <div className="surface text-xs text-red-300 break-words">Error: {errors.message}</div>
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
        <div className="surface text-xs text-slate-200 break-words">Generated: {output.generated}</div>
      ) : null}
      {output.posted ? (
        <div className="surface text-xs text-emerald-200 break-words">Posted: {output.posted}</div>
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
            <div>Output at: {output.modelOutputAt ? new Date(output.modelOutputAt).toLocaleString() : 'n/a'}</div>
            <div>Failed at: {errors.failedAt ? new Date(errors.failedAt).toLocaleString() : 'n/a'}</div>
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
          <summary className="cursor-pointer select-none text-slate-300">Run #{selectedRun.runId} details</summary>
          <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-slate-200">
            {JSON.stringify(selectedRun, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
