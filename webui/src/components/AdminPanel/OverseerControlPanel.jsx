import { useState } from 'react';

export default function OverseerControlPanel({ state, onClearHistory, clearingHistory }) {
  const [showPayload, setShowPayload] = useState(false);
  if (!state) {
    return (
      <div className="space-y-0.5">
        <div className="panel-muted text-xs uppercase">Overseer Control</div>
        <div className="surface text-xs text-slate-300">No status received yet.</div>
      </div>
    );
  }

  const runtime = state.runtime || {};
  const cfg = state.config || {};
  const output = state.output || {};
  const timings = state.timings || {};
  const input = state.input || {};
  const errors = state.errors || {};

  return (
    <div className="space-y-0.5">
      <div className="panel-muted text-xs uppercase">Overseer Control</div>
      <div className="flex gap-0.5 text-xs">
        <button
          type="button"
          onClick={onClearHistory}
          disabled={Boolean(clearingHistory)}
          className="button-danger disabled:cursor-not-allowed disabled:opacity-60"
        >
          {clearingHistory ? 'Clearing...' : 'Clear Overseer History'}
        </button>
      </div>
      <div className="surface flex flex-wrap gap-0.5 text-xs">
        <span className="surface-muted">running: {runtime.running ? 'yes' : 'no'}</span>
        <span className="surface-muted">phase: {runtime.phase || '--'}</span>
        <span className="surface-muted">tick: {runtime.tickCount ?? 0}</span>
        <span className="surface-muted">trigger: {runtime.lastTriggerReason || '--'}</span>
        <span className="surface-muted">name: {cfg.name || '--'}</span>
        <span className="surface-muted">model: {cfg.model || '--'}</span>
        <span className="surface-muted">observeOnly: {cfg.observeOnly ? 'yes' : 'no'}</span>
        <span className="surface-muted">decision: {output.normalized || '--'}</span>
        <span className="surface-muted">outcome: {output.outcome || '--'}</span>
        <span className="surface-muted">reason: {output.reason || '--'}</span>
        <span className="surface-muted">last gen: {timings.lastGenerationMs != null ? `${timings.lastGenerationMs}ms` : '--'}</span>
      </div>

      <details className="surface text-xs text-slate-200" open>
        <summary className="cursor-pointer select-none text-slate-300">Latest Context</summary>
        <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-slate-200">
          {input.stateUpdate || '<none>'}
        </pre>
      </details>

      <details className="surface text-xs text-slate-200">
        <summary className="cursor-pointer select-none text-slate-300">Tool Availability</summary>
        <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-slate-200">
          {JSON.stringify({ available: input.availableTools, blocked: input.blockedTools }, null, 2)}
        </pre>
      </details>

      {errors.message ? <div className="surface text-xs text-red-300">Error: {errors.message}</div> : null}

      <details className="surface text-xs text-slate-200">
        <summary className="cursor-pointer select-none text-slate-300">Recent Runs</summary>
        <pre className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-slate-200">
          {JSON.stringify(state.history || [], null, 2)}
        </pre>
      </details>

      <button type="button" className="button-dark text-xs" onClick={() => setShowPayload((v) => !v)}>
        {showPayload ? 'Hide Full Payload' : 'Show Full Payload'}
      </button>
      {showPayload ? (
        <pre className="surface whitespace-pre-wrap break-words text-[0.72rem] text-slate-200">{JSON.stringify(state, null, 2)}</pre>
      ) : null}
    </div>
  );
}
