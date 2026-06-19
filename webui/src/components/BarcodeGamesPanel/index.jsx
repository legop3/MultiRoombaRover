// Barcode Games Panel
// Purpose: Shows barcode game selection, current game status, and player points in the Activities tab.
// Scope: Keeps the driver-side UI compact but informative; game-specific rules stay in server game modules.
import { useEffect, useMemo, useRef, useState } from 'react';
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
      borderLeftColor: rgba(rgb, 0.9),
    },
    selectedButtonStyle: {
      borderLeftColor: rgba(rgb, 1),
      backgroundColor: rgba(rgb, 0.12),
    },
    titleBoxStyle: {
      borderLeftColor: rgba(rgb, 0.88),
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
      className="surface flex min-h-[3.5rem] flex-col items-start justify-between border-l-4 border-l-neutral-600 px-1 py-0.75 text-left transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-70"
      style={style}
    >
      <span className="flex w-full items-start justify-between gap-1">
        <span className="text-sm font-semibold leading-tight text-neutral-50" style={theme.textStyle}>{game.title}</span>
        <span className="surface-muted shrink-0 px-1 py-0 text-center font-mono text-[0.72rem] text-neutral-200">{game.voteCount || 0}</span>
      </span>
      <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-neutral-300">{game.description}</span>
      <span className="mt-0.5 text-[0.7rem] font-semibold text-neutral-400">
        {game.active ? 'Active' : game.selected ? 'Selected' : game.actionLabel || 'Vote'}
      </span>
    </button>
  );
}

function StatGrid({ stats, theme }) {
  if (!Array.isArray(stats) || !stats.length) return null;
  return (
    <div className="grid gap-0.5 sm:grid-cols-3">
      {stats.slice(0, 6).map((stat) => (
        <div key={stat.label} className="surface px-1 py-0.75 text-center">
          <p className="truncate text-[0.68rem] text-neutral-400">{stat.label}</p>
          <p className="mt-0.25 truncate text-base font-semibold leading-tight text-neutral-100" style={theme.textStyle}>{stat.value}</p>
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
    <div className="surface min-w-0 px-1 py-0.75">
      <p className="text-sm font-semibold text-neutral-400">Participants</p>
      <p className="font-mono text-xl font-semibold leading-tight text-neutral-50" style={theme.textStyle}>
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
      <div className="grid gap-0.5">
        {entries.slice(0, 4).map((entry) => (
          <div key={`${entry.entityId || entry.code}-${entry.type || 'counter'}`} className="surface-muted grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-0.5 px-1 py-0.5 text-xs">
            <span className="min-w-0 truncate text-neutral-200">{entry.label || entry.entityId || entry.code}</span>
            <span className="text-right font-mono text-neutral-200">{entry.count || 0}</span>
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
      <div className="surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-1 py-0.75">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-neutral-300">Your points</p>
          <p className="truncate text-[0.7rem] text-neutral-400">
            {ownPlayer?.rank ? `Rank ${ownPlayer.rank}` : 'No rank yet'}
          </p>
        </div>
        <p className="font-mono text-xl font-semibold leading-tight text-neutral-50">
          {hasOwnPoints ? ownPlayer.totalPoints : 0}
        </p>
      </div>
      <div className="surface px-1 py-0.75">
        <p className="mb-0.5 text-xs font-semibold text-neutral-300">Leaderboard</p>
        {Array.isArray(players) && players.length ? (
          <div className="grid gap-0.5">
            {players.slice(0, 4).map((player, idx) => (
              <div key={player.playerKey} className="surface-muted grid grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-0.5 px-1 py-0.5 text-xs">
                <span className="font-mono text-neutral-500">{idx + 1}</span>
                <span className="truncate text-neutral-200">{player.nickname}</span>
                <span className="text-right font-mono text-neutral-200">{player.totalPoints}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-neutral-500">No points yet</p>
        )}
      </div>
    </div>
  );
}
export default function BarcodeGamesPanel() {
  const { state, connectionState, voteForGame } = useBarcodeGameState();
  const [pendingGameId, setPendingGameId] = useState(null);
  const activeSignatureRef = useRef('');
  const participantCountRef = useRef(0);
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

  useEffect(() => {
    const signature = `${activeGame?.id || 'none'}:${activeGame?.status || state.phase || 'unknown'}`;
    if (activeSignatureRef.current === signature) return;
    activeSignatureRef.current = signature;

    /*
      Game lifecycle events are derived from server state instead of button
      clicks so they still report games started by another user or by a scanner
      workflow outside this panel.
    */
    trackAnalyticsEvent('barcode_game_active_change', {
      gameId: activeGame?.id || '',
      status: activeGame?.status || '',
      phase: state.phase || 'unknown',
    });

    if (activeGame?.status === 'ending' || state.phase === 'ending') {
      trackAnalyticsEvent('barcode_game_round_end', {
        gameId: activeGame?.id || '',
        participantCount: participants.length,
      });
    }
  }, [activeGame?.id, activeGame?.status, participants.length, state.phase]);

  useEffect(() => {
    if (participants.length <= participantCountRef.current) {
      participantCountRef.current = participants.length;
      return;
    }
    participantCountRef.current = participants.length;
    trackAnalyticsEvent('barcode_game_player_join', {
      gameId: activeGame?.id || '',
      participantCount: participants.length,
    });
  }, [activeGame?.id, participants.length]);

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
    <CardFrame title="Barcode games" bodyClassName="space-y-1 p-0.5 text-sm">
      <div className="grid gap-0.5 sm:grid-cols-2">
        {games.map((game) => (
          <GameChoice
            key={game.id}
            game={game}
            disabled={Boolean(pendingGameId) || votingDisabled}
            onVote={handleVote}
          />
        ))}
      </div>

      <section className="space-y-1 border-t border-neutral-700 pt-1">
        <div className="grid items-stretch gap-0.5 lg:grid-cols-[minmax(0,1fr)_9rem_10rem]">
          <div className="surface min-w-0 border-l-4 border-neutral-700 px-1 py-0.75" style={activeTheme.titleBoxStyle}>
            <p className="break-words text-xl font-bold leading-tight text-neutral-50" style={activeTheme.textStyle}>
              {display.title || activeGame?.title || 'No game active'}
            </p>
            <p className="mt-0.5 break-words text-sm font-semibold leading-tight text-neutral-200">
              {display.primary || 'Vote for a game to start'}
            </p>
            {display.secondary ? (
              <p className="mt-0.5 break-words text-xs leading-snug text-neutral-300">{display.secondary}</p>
            ) : null}
          </div>
          <div className="surface px-1 py-0.75 text-left lg:text-right">
            <p className="text-xs font-semibold text-neutral-400">{display.timer?.label || 'Time'}</p>
            <p className="font-mono text-xl font-semibold leading-tight text-neutral-50" style={activeTheme.textStyle}>
              {timerText || '--'}
            </p>
            <p className="text-xs leading-tight text-neutral-500">
              {timerText ? 'active timer' : 'no timer'}
            </p>
          </div>
          <ParticipantsBlock participants={participants} theme={activeTheme} />
        </div>
        <StatGrid stats={display.stats} theme={activeTheme} />
      </section>

      <Leaderboard players={state.leaderboard} ownPlayer={state.ownPlayer} />

      <div className="grid gap-0.5 border-t border-neutral-700 pt-1 sm:grid-cols-2">
        <div className="surface px-1 py-0.75">
          <CounterList title="Most scanned objects" entries={state.counters?.objects} />
        </div>
        <div className="surface px-1 py-0.75">
          <CounterList title="Most scanned rovers" entries={state.counters?.rovers} />
        </div>
      </div>
    </CardFrame>
  );
}
