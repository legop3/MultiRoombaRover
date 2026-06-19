// Barcode Games Panel
// Purpose: Shows barcode game selection, current game status, and player points in the Activities tab.
// Scope: Keeps the driver-side UI compact but informative; game-specific rules stay in server game modules.
import { useEffect, useMemo, useState } from 'react';
import useBarcodeGameState from '../../barcodeGames/useBarcodeGameState.js';
import CardFrame from '../CardFrame/index.jsx';

function useClock(enabled) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return now;
}

function formatTimer(endsAt, now) {
  if (!Number.isFinite(endsAt)) return null;
  const totalSeconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}

function GameChoice({ game, disabled, onVote }) {
  return (
    <button
      type="button"
      disabled={disabled || game.active}
      onClick={() => onVote(game.id)}
      className={[
        'button-dark flex min-h-[4.25rem] flex-col items-start justify-between px-1.5 py-1 text-left disabled:opacity-70',
        game.active ? 'border-emerald-500/70' : '',
        game.selected && !game.active ? 'border-cyan-500/60' : '',
      ].filter(Boolean).join(' ')}
    >
      <span className="flex w-full items-start justify-between gap-1">
        <span className="text-sm font-semibold leading-tight text-neutral-50">{game.title}</span>
        <span className="shrink-0 font-mono text-[0.72rem] text-neutral-300">{game.voteCount || 0}</span>
      </span>
      <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-neutral-300">{game.description}</span>
      <span className="mt-0.5 text-[0.7rem] font-semibold text-neutral-200">
        {game.active ? 'Active' : game.selected ? 'Selected' : game.actionLabel || 'Vote'}
      </span>
    </button>
  );
}

function StatGrid({ stats }) {
  if (!Array.isArray(stats) || !stats.length) return null;
  return (
    <div className="grid gap-1 sm:grid-cols-3">
      {stats.slice(0, 6).map((stat) => (
        <div key={stat.label} className="border border-neutral-700 px-1.5 py-1">
          <p className="truncate text-[0.68rem] text-neutral-400">{stat.label}</p>
          <p className="truncate text-sm font-semibold text-neutral-100">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function ParticipantsBlock({ participants }) {
  const knownParticipants = Array.isArray(participants) ? participants : [];
  // Participants are server-owned because rover scans, identity lookup, and
  // score eligibility all happen outside this panel. The UI only formats the
  // current round list so users can tell whether their rover was counted.
  const displayNames = knownParticipants
    .map((participant) => participant?.nickname || participant?.roverId)
    .filter(Boolean);

  return (
    <div className="min-w-0 border border-neutral-700 px-2 py-1.5">
      <p className="text-sm font-semibold text-neutral-400">Participants</p>
      <p className="font-mono text-2xl font-semibold leading-tight text-neutral-50">
        {knownParticipants.length}
      </p>
      <p className="truncate text-sm leading-tight text-neutral-300">
        {displayNames.length ? displayNames.join(', ') : 'Scan rover to join'}
      </p>
    </div>
  );
}

function CounterList({ title, entries }) {
  if (!Array.isArray(entries) || !entries.length) return null;
  return (
    <div>
      <p className="mb-0.5 text-xs font-semibold text-neutral-300">{title}</p>
      <div className="space-y-0.5">
        {entries.slice(0, 4).map((entry) => (
          <div key={`${entry.entityId || entry.code}-${entry.type || 'counter'}`} className="flex justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-neutral-200">{entry.label || entry.entityId || entry.code}</span>
            <span className="font-mono text-neutral-300">{entry.count || 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Leaderboard({ players, ownPlayer }) {
  const hasOwnPoints = ownPlayer && Number.isFinite(ownPlayer.totalPoints);
  return (
    <div className="space-y-1">
      <div className="grid gap-1 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="border border-neutral-700 px-1.5 py-1">
          <p className="text-xs text-neutral-400">Your points</p>
          <p className="text-lg font-semibold leading-tight text-neutral-50">
            {hasOwnPoints ? ownPlayer.totalPoints : 0}
          </p>
          {ownPlayer?.rank ? <p className="text-[0.7rem] text-neutral-400">Rank {ownPlayer.rank}</p> : null}
        </div>
        <div className="border border-neutral-700 px-1.5 py-1">
          <p className="mb-0.5 text-xs font-semibold text-neutral-300">Leaderboard</p>
          {Array.isArray(players) && players.length ? (
            <div className="space-y-0.5">
              {players.slice(0, 4).map((player, idx) => (
                <div key={player.playerKey} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-1 text-xs">
                  <span className="font-mono text-neutral-500">{idx + 1}</span>
                  <span className="truncate text-neutral-200">{player.nickname}</span>
                  <span className="font-mono text-neutral-300">{player.totalPoints}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">No points yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BarcodeGamesPanel() {
  const { state, voteForGame } = useBarcodeGameState();
  const [pendingGameId, setPendingGameId] = useState(null);
  const activeGame = state.activeGame;
  const display = activeGame?.display || {};
  // Voting should stop once the shared game system has moved past selection.
  // The joining phase is included because it is still part of starting the
  // selected game, even though game rules are not running until the countdown.
  const votingDisabled = state.phase === 'joining' || state.phase === 'starting' || state.phase === 'running';
  const timerEndsAt = display.timer?.endsAt;
  const now = useClock(Number.isFinite(timerEndsAt));
  const timerText = formatTimer(timerEndsAt, now);
  const games = useMemo(() => (Array.isArray(state.games) ? state.games : []), [state.games]);
  const participants = Array.isArray(state.participants) ? state.participants : [];

  const handleVote = async (gameId) => {
    setPendingGameId(gameId);
    try {
      await voteForGame(gameId);
    } finally {
      setPendingGameId(null);
    }
  };

  return (
    <CardFrame title="Barcode games" bodyClassName="space-y-2 p-1.5 text-sm">
      <div className="grid gap-1 sm:grid-cols-2">
        {games.map((game) => (
          <GameChoice
            key={game.id}
            game={game}
            disabled={Boolean(pendingGameId) || votingDisabled}
            onVote={handleVote}
          />
        ))}
      </div>

      <section className="space-y-2 border-t border-neutral-700 pt-2">
        <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,1fr)_15rem_15rem]">
          <div className="min-w-0">
            <p className="break-words text-2xl font-bold leading-tight text-neutral-50">
              {display.title || activeGame?.title || 'No game active'}
            </p>
            <p className="mt-0.5 break-words text-lg font-semibold leading-tight text-neutral-200">
              {display.primary || 'Vote for a game to start'}
            </p>
            {display.secondary ? (
              <p className="mt-1 break-words text-base leading-snug text-neutral-300">{display.secondary}</p>
            ) : null}
          </div>
          <div className="border border-neutral-700 px-2 py-1.5 text-left lg:text-right">
            <p className="text-sm font-semibold text-neutral-400">{display.timer?.label || 'Time'}</p>
            <p className="font-mono text-2xl font-semibold leading-tight text-neutral-50">
              {timerText || '--'}
            </p>
            <p className="text-sm leading-tight text-neutral-500">
              {timerText ? 'active timer' : 'no timer'}
            </p>
          </div>
          <ParticipantsBlock participants={participants} />
        </div>
        <StatGrid stats={display.stats} />
      </section>

      <Leaderboard players={state.leaderboard} ownPlayer={state.ownPlayer} />

      <div className="grid gap-2 border-t border-neutral-700 pt-1.5 sm:grid-cols-2">
        <CounterList title="Most scanned objects" entries={state.counters?.objects} />
        <CounterList title="Most scanned rovers" entries={state.counters?.rovers} />
      </div>
    </CardFrame>
  );
}
