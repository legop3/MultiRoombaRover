// Button Box Tile
// Purpose: Defines the Button Box Tile module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export default function ButtonBoxTile({
  buttonId,
  count,
  goal,
  rewardNumber,
  rewardName,
  className = '',
}) {
  return (
    <article className={['surface px-0.5 py-0.5 text-center', className].filter(Boolean).join(' ')}>
      <p className="text-xs text-slate-400">Button {buttonId}</p>
      <p className="text-sm font-semibold text-white">{count} / {goal}</p>
      <p className="truncate text-[0.7rem] text-slate-300">#{rewardNumber} {rewardName}</p>
    </article>
  );
}
