// Button Box Tile
// Purpose: Defines the Button Box Tile module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export default function ButtonBoxTile({
  buttonId,
  count,
  goal,
  rewardNumber,
  rewardName,
  rewardDescription,
  dailyCount,
  dailyLimit,
  limited = false,
  className = '',
}) {
  /*
    The server owns the actual cap decision, but the tile still derives a
    display-only "limit reached" state so normal session snapshots and immediate
    capped press toasts render the same daily status text.
  */
  const hasDailyLimit = Number.isFinite(dailyLimit) && dailyLimit > 0;
  const safeDailyCount = Number.isFinite(dailyCount) ? dailyCount : 0;
  const limitReached = Boolean(limited) || (hasDailyLimit && safeDailyCount >= dailyLimit);
  const cleanDescription = typeof rewardDescription === 'string' && rewardDescription.trim()
    ? rewardDescription.trim()
    : null;

  return (
    <article className={['surface px-1 py-0.5 text-center', className].filter(Boolean).join(' ')}>
      <p className="text-xs text-slate-400">Button {buttonId}</p>
      <p className="text-sm font-semibold text-white">{count} / {goal}</p>
      <p className="truncate text-[0.7rem] text-slate-300">#{rewardNumber} {rewardName}</p>
      {cleanDescription ? (
        <p className="line-clamp-2 text-[0.65rem] leading-tight text-slate-400">{cleanDescription}</p>
      ) : null}
      {hasDailyLimit ? (
        <p className={['text-[0.65rem] font-semibold leading-tight', limitReached ? 'text-red-300' : 'text-cyan-200'].join(' ')}>
          {limitReached ? 'Daily limit reached' : `Today ${safeDailyCount} / ${dailyLimit}`}
        </p>
      ) : null}
    </article>
  );
}
