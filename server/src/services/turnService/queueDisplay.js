// Shared display ordering only; each service still owns its queue policy.
function describeQueue(queue, currentId) {
  const currentIndex = currentId ? queue.indexOf(currentId) : -1;
  const nextId = queue.length > 1
    ? queue[(currentIndex + 1) % queue.length]
    : null;
  return { queue, currentId, nextId };
}

module.exports = { describeQueue };
