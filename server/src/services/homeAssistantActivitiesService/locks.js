// Locks last only for this server process. Keying by entity ID keeps a display
// name change from unlocking an item while avoiding any persistence machinery.
function createLocks() {
  const lockedIds = new Set();
  return {
    isLocked: (id) => lockedIds.has(id),
    setLocked(id, locked) {
      if (locked) lockedIds.add(id);
      else lockedIds.delete(id);
    },
  };
}

function resolveItem(items, query) {
  const normalized = String(query || '').trim().toLowerCase();
  // Exact IDs take precedence; names deliberately do not use fuzzy matching
  // because a moderation command must never lock a merely similar device.
  const idMatch = items.find((item) => item.id.toLowerCase() === normalized);
  if (idMatch) return idMatch;
  const matches = items.filter((item) => item.name.toLowerCase() === normalized);
  if (matches.length > 1) throw new Error(`Name is ambiguous. Use an entity ID: ${matches.map((item) => item.id).join(', ')}`);
  if (!matches.length) throw new Error('No activity item matches that name or entity ID');
  return matches[0];
}

module.exports = { createLocks, resolveItem };
