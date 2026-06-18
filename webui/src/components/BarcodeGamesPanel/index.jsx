// Barcode Games Panel
// Purpose: Shows global barcode game state and voting controls inside the
// driver's Activities tab.
// Scope: This panel is intentionally compact because the scanner page remains
// the main room-facing game interface.
import { useMemo, useState } from 'react';
import useBarcodeGameState from '../../barcodeGames/useBarcodeGameState.js';
import CardFrame from '../CardFrame/index.jsx';

function formatCounter(entry) {
  const label = typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : 'unknown';
  const count = Number.isFinite(entry?.count) ? entry.count : 0;
  return `${label} ${count}`;
}

function formatRecord(activeGame) {
  const record = activeGame?.worldRecord;
  if (!record) return null;
  const rate = Number.isFinite(record.scansPerSecond) ? record.scansPerSecond.toFixed(2) : '0.00';
  return `${rate} scans per second`;
}

function GameVoteButton({ game, disabled, onVote }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onVote(game.id)}
      className={[
        'button-dark min-w-0 flex-1 px-1 py-0.5 text-left text-xs disabled:opacity-50',
        game.active ? 'border-emerald-300 bg-emerald-950/70 text-emerald-50' : '',
      ].filter(Boolean).join(' ')}
    >
      <span className="block truncate font-semibold">{game.title}</span>
      <span className="block text-[0.68rem] text-slate-300">{game.voteCount || 0} votes</span>
    </button>
  );
}

function CounterList({ title, entries }) {
  if (!Array.isArray(entries) || !entries.length) return null;
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[0.68rem] font-semibold text-slate-300">{title}</p>
      <div className="space-y-0.5">
        {entries.slice(0, 3).map((entry) => (
          <p key={`${entry.entityId || entry.code}-${entry.type || 'counter'}`} className="truncate text-xs text-slate-100">
            {formatCounter(entry)}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function BarcodeGamesPanel() {
  const { state, voteForGame } = useBarcodeGameState();
  const [pendingGameId, setPendingGameId] = useState(null);
  const activeGame = state.activeGame;
  const recordText = formatRecord(activeGame);
  const counters = state.counters || {};
  const voteButtons = useMemo(() => (Array.isArray(state.games) ? state.games : []), [state.games]);

  const handleVote = async (gameId) => {
    setPendingGameId(gameId);
    try {
      await voteForGame(gameId);
    } finally {
      setPendingGameId(null);
    }
  };

  return (
    <CardFrame title="Barcode games" bodyClassName="space-y-1 p-1 text-sm">
      <div className="grid gap-0.5 sm:grid-cols-2">
        {voteButtons.map((game) => (
          <GameVoteButton
            key={game.id}
            game={game}
            disabled={Boolean(pendingGameId)}
            onVote={handleVote}
          />
        ))}
      </div>

      <div className="rounded border border-neutral-700 bg-neutral-950/70 p-1">
        <p className="truncate text-sm font-semibold text-white">
          {activeGame?.title || 'No barcode game'}
        </p>
        <p className="mt-0.5 text-xs text-slate-200">
          {activeGame?.headline || 'vote for a game to start'}
        </p>
        {activeGame?.detail ? (
          <p className="mt-0.5 truncate text-[0.72rem] text-slate-400">{activeGame.detail}</p>
        ) : null}
        {recordText ? (
          <p className="mt-0.5 text-[0.72rem] text-emerald-200">world record {recordText}</p>
        ) : null}
      </div>

      <div className="grid gap-1 sm:grid-cols-2">
        <CounterList title="Most scanned objects" entries={counters.objects} />
        <CounterList title="Most scanned rovers" entries={counters.rovers} />
      </div>
    </CardFrame>
  );
}
