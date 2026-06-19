// Barcode Games Panel
// Purpose: Shows barcode game selection, current game status, and player points in the Activities tab.
// Scope: Keeps the driver-side UI compact but informative; game-specific rules stay in server game modules.
import { useEffect, useMemo, useState } from 'react';
import useBarcodeGameState from '../../barcodeGames/useBarcodeGameState.js';
import CardFrame from '../CardFrame/index.jsx';
import { trackAnalyticsEvent } from '../../analytics/index.js';

function clampRgbChannel(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeRgb(themeColor) {
  const r = clampRgbChannel(themeColor?.r);
  const g = clampRgbChannel(themeColor?.g);
  const b = clampRgbChannel(themeColor?.b);
  if (r === null || g === null || b === null) return null;
  return { r, g, b };
}

function rgba(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function getGameTheme(themeColor) {
  const rgb = normalizeRgb(themeColor);
  if (!rgb) {
    return {
      textStyle: undefined,
      buttonStyle: undefined,
      titleBoxStyle: undefined,
      boxStyle: undefined,
    };
  }

  // The game supplies only identity color. This component chooses opacity and
  // placement so every game stays visually consistent with the dark CardFrame
  // UI while still being recognizable at a glance.
  return {
    textStyle: { color: rgba(rgb, 0.96) },
    buttonStyle: {
      borderColor: rgba(rgb, 0.62),
      borderLeftColor: rgba(rgb, 0.9),
      backgroundColor: rgba(rgb, 0.1),
    },
    selectedButtonStyle: {
      borderColor: rgba(rgb, 0.86),
      borderLeftColor: rgba(rgb, 1),
      backgroundColor: rgba(rgb, 0.16),
    },
    titleBoxStyle: {
      borderLeftColor: rgba(rgb, 0.88),
    },
    boxStyle: {
      borderColor: rgba(rgb, 0.62),
    },
  };
}

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
  const theme = getGameTheme(game.themeColor);
  const style = game.active || game.selected ? theme.selectedButtonStyle || theme.buttonStyle : theme.buttonStyle;
  return (
    <button
      type="button"
      disabled={disabled || game.active}
      onClick={() => onVote(game.id)}
      className="button-dark flex min-h-[4.25rem] flex-col items-start justify-between border-l-4 px-1.5 py-1 text-left disabled:opacity-70"
      style={style}
    >
      <span className="flex w-full items-start justify-between gap-1">
        <span className="text-sm font-semibold leading-tight text-neutral-50" style={theme.textStyle}>{game.title}</span>
        <span className="shrink-0 font-mono text-[0.72rem] text-neutral-300">{game.voteCount || 0}</span>
      </span>
      <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-neutral-300">{game.description}</span>
      <span className="mt-0.5 text-[0.7rem] font-semibold text-neutral-200">
        {game.active ? 'Active' : game.selected ? 'Selected' : game.actionLabel || 'Vote'}
      </span>
    </button>
  );
}

function StatGrid({ stats, theme }) {
  if (!Array.isArray(stats) || !stats.length) return null;
  return (
    <div className="grid gap-1 sm:grid-cols-3">
      {stats.slice(0, 6).map((stat) => (
        <div key={stat.label} className="border border-neutral-700 px-1.5 py-1" style={theme.boxStyle}>
          <p className="truncate text-[0.68rem] text-neutral-400">{stat.label}</p>
          <p className="truncate text-sm font-semibold text-neutral-100">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function ParticipantsBlock({ participants, theme }) {
  const knownParticipants = Array.isArray(participants) ? participants : [];
  // Participants are server-owned because rover scans, identity lookup, and
  // score eligibility all happen outside this panel. The UI only formats the
  // current round list so users can tell whether their rover was counted.
  const displayNames = knownParticipants
    .map((participant) => participant?.nickname || participant?.roverId)
    .filter(Boolean);

  return (
    <div className="min-w-0 border border-neutral-700 px-2 py-1.5" style={theme.boxStyle}>
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
  const { state, connectionState, voteForGame } = useBarcodeGameState();
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
  const activeTheme = getGameTheme(activeGame?.themeColor);

  useEffect(() => {
    if (!connectionState.stale || !connectionState.lastReceivedAt) return;
    /*
      Stale barcode-game state is worth tracking because it points to a real
      interaction problem: users can be looking at old game choices or scores
      even though the rest of the page appears loaded.
    */
    trackAnalyticsEvent('barcode_game_state_stale', {
      connected: connectionState.connected,
      phase: state.phase || 'unknown',
    });
  }, [connectionState.connected, connectionState.lastReceivedAt, connectionState.stale, state.phase]);

  const handleVote = async (gameId) => {
    setPendingGameId(gameId);
    trackAnalyticsEvent('barcode_game_vote', {
      gameId,
      phase: state.phase || 'unknown',
      status: 'started',
    });
    try {
      await voteForGame(gameId);
      trackAnalyticsEvent('barcode_game_vote', {
        gameId,
        phase: state.phase || 'unknown',
        status: 'accepted',
      });
    } catch (error) {
      trackAnalyticsEvent('barcode_game_vote', {
        gameId,
        phase: state.phase || 'unknown',
        status: 'failed',
        reason: error?.message || 'unknown',
      });
      throw error;
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
          <div className="min-w-0 border-l-4 border-neutral-700 pl-2" style={activeTheme.titleBoxStyle}>
            <p className="break-words text-2xl font-bold leading-tight text-neutral-50" style={activeTheme.textStyle}>
              {display.title || activeGame?.title || 'No game active'}
            </p>
            <p className="mt-0.5 break-words text-lg font-semibold leading-tight text-neutral-200">
              {display.primary || 'Vote for a game to start'}
            </p>
            {display.secondary ? (
              <p className="mt-1 break-words text-base leading-snug text-neutral-300">{display.secondary}</p>
            ) : null}
          </div>
          <div className="border border-neutral-700 px-2 py-1.5 text-left lg:text-right" style={activeTheme.boxStyle}>
            <p className="text-sm font-semibold text-neutral-400">{display.timer?.label || 'Time'}</p>
            <p className="font-mono text-2xl font-semibold leading-tight text-neutral-50">
              {timerText || '--'}
            </p>
            <p className="text-sm leading-tight text-neutral-500">
              {timerText ? 'active timer' : 'no timer'}
            </p>
          </div>
          <ParticipantsBlock participants={participants} theme={activeTheme} />
        </div>
        <StatGrid stats={display.stats} theme={activeTheme} />
      </section>

      <Leaderboard players={state.leaderboard} ownPlayer={state.ownPlayer} />

      <div className="grid gap-2 border-t border-neutral-700 pt-1.5 sm:grid-cols-2">
        <CounterList title="Most scanned objects" entries={state.counters?.objects} />
        <CounterList title="Most scanned rovers" entries={state.counters?.rovers} />
      </div>
    </CardFrame>
  );
}
