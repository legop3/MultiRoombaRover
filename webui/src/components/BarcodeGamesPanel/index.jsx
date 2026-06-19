// Barcode Games Panel
// Purpose: Shows global barcode game state and voting controls inside the driver's Activities tab.
// Scope: Gives drivers a readable control/status surface while the scanner page remains the room-facing display.
import { useMemo, useState } from 'react';
import useBarcodeGameState from '../../barcodeGames/useBarcodeGameState.js';
import CardFrame from '../CardFrame/index.jsx';

function formatSeconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}

function formatCounter(entry) {
  const label = typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : 'unknown';
  const count = Number.isFinite(entry?.count) ? entry.count : 0;
  return { label, count };
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
        'button-dark min-h-[5.5rem] min-w-0 px-2 py-1.5 text-left disabled:opacity-50',
        game.active ? 'border-emerald-300 bg-emerald-950/80 text-emerald-50' : 'bg-neutral-950/80',
      ].filter(Boolean).join(' ')}
    >
      <span className="flex items-start justify-between gap-1">
        <span className="text-base font-semibold leading-tight">{game.title}</span>
        <span className="shrink-0 rounded border border-neutral-600 px-1 py-0.5 text-xs text-slate-200">
          {game.voteCount || 0} votes
        </span>
      </span>
      <span className="mt-1 block text-sm leading-snug text-slate-300">{game.description}</span>
      <span className="mt-1 block text-xs font-semibold text-emerald-200">
        {game.active ? 'Active' : game.actionLabel || 'Start'}
      </span>
    </button>
  );
}

function CounterList({ title, entries }) {
  if (!Array.isArray(entries) || !entries.length) return null;
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-semibold text-slate-200">{title}</p>
      <div className="space-y-1">
        {entries.slice(0, 3).map((entry) => (
          <div
            key={`${entry.entityId || entry.code}-${entry.type || 'counter'}`}
            className="flex items-center justify-between gap-2 rounded border border-neutral-700 bg-neutral-950/70 px-2 py-1"
          >
            <span className="min-w-0 truncate text-sm text-slate-100">{formatCounter(entry).label}</span>
            <span className="font-mono text-sm font-semibold text-slate-200">{formatCounter(entry).count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Leaderboard({ players }) {
  if (!Array.isArray(players) || !players.length) return null;
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-slate-200">Player points</p>
      <div className="space-y-1">
        {players.slice(0, 5).map((player, idx) => (
          <div
            key={player.playerKey}
            className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded border border-neutral-700 bg-neutral-950/70 px-2 py-1"
          >
            <span className="font-mono text-sm text-slate-400">{idx + 1}</span>
            <span className="truncate text-sm font-semibold text-white">{player.nickname}</span>
            <span className="font-mono text-sm text-emerald-200">{player.totalPoints}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BarcodeGamesPanel() {
  const { state, resetActiveGame, voteForGame } = useBarcodeGameState();
  const [pendingGameId, setPendingGameId] = useState(null);
  const [resetPending, setResetPending] = useState(false);
  const activeGame = state.activeGame;
  const recordText = formatRecord(activeGame);
  const remainingText = formatSeconds(activeGame?.remainingMs);
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

  const handleReset = async () => {
    setResetPending(true);
    try {
      await resetActiveGame();
    } finally {
      setResetPending(false);
    }
  };

  return (
    <CardFrame
      title="Barcode games"
      bodyClassName="space-y-3 p-2 text-sm"
      actions={
        activeGame ? (
          <button
            type="button"
            className="button-dark px-2 py-1 text-xs disabled:opacity-50"
            disabled={resetPending}
            onClick={handleReset}
          >
            Reset active game
          </button>
        ) : null
      }
    >
      <div className="grid gap-2 md:grid-cols-2">
        {voteButtons.map((game) => (
          <GameVoteButton
            key={game.id}
            game={game}
            disabled={Boolean(pendingGameId)}
            onVote={handleVote}
          />
        ))}
      </div>

      <div className="rounded border border-neutral-700 bg-neutral-950/80 p-3">
        <p className="truncate text-xl font-bold leading-tight text-white">
          {activeGame?.title || 'No barcode game'}
        </p>
        <p className="mt-1 text-lg font-semibold leading-snug text-slate-100">
          {activeGame?.headline || 'vote for a game to start'}
        </p>
        {activeGame?.detail ? (
          <p className="mt-1 text-sm leading-snug text-slate-300">{activeGame.detail}</p>
        ) : null}
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {remainingText ? (
            <div className="rounded border border-neutral-700 bg-black/30 px-2 py-1">
              <p className="text-xs text-slate-400">Time left</p>
              <p className="font-mono text-lg font-semibold text-white">{remainingText}</p>
            </div>
          ) : null}
          {recordText ? (
            <div className="rounded border border-neutral-700 bg-black/30 px-2 py-1 sm:col-span-2">
              <p className="text-xs text-slate-400">World record</p>
              <p className="text-lg font-semibold text-emerald-200">{recordText}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Leaderboard players={state.leaderboard} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <CounterList title="Most scanned objects" entries={counters.objects} />
          <CounterList title="Most scanned rovers" entries={counters.rovers} />
        </div>
      </div>
    </CardFrame>
  );
}
