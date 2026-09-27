// utils
// Purpose: Defines the utils module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export function formatDriverLabel({ roverId, session }) {
  const turn = session?.roster?.find((rover) => String(rover.id) === String(roverId))?.turn;
  const driver = turn?.queue?.find((entry) => entry.socketId === turn.currentId);
  const label = driver?.name || 'No driver';
  return session?.mode === 'turns' && turn?.currentId ? `${label} (turns)` : label;
}
