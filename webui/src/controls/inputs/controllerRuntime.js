// Controller Runtime Coordination
// Purpose: Shares controller-only runtime facts without pushing animation-frame data through
// React's application-wide control reducer.
// Scope: Owns prompt modality, the last controller used, and temporary command suppression while
// a controller is being configured. It does not send rover commands or interpret bindings.
import { useSyncExternalStore } from 'react';

const listeners = new Set();
const controlLocks = new Set();

let snapshot = {
  inputMethod: 'keyboard',
  controller: null,
};

function publish(nextSnapshot) {
  if (
    nextSnapshot.inputMethod === snapshot.inputMethod &&
    nextSnapshot.controller?.signature === snapshot.controller?.signature &&
    nextSnapshot.controller?.id === snapshot.controller?.id &&
    nextSnapshot.controller?.mapping === snapshot.controller?.mapping
  ) {
    return;
  }
  snapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
}

export function markKeyboardInputActive() {
  publish({ ...snapshot, inputMethod: 'keyboard' });
}

export function markControllerInputActive(controller) {
  if (!controller) return;
  publish({
    inputMethod: 'controller',
    controller: {
      signature: controller.signature ?? null,
      id: controller.id ?? 'Unknown controller',
      mapping: controller.mapping ?? '',
    },
  });
}

export function markControllerDisconnected(signature) {
  if (!snapshot.controller || snapshot.controller.signature !== signature) return;
  publish({ inputMethod: 'keyboard', controller: null });
}

export function acquireControllerControlLock(reason = 'controller-configuration') {
  /*
    A tokenized lock is used instead of one boolean because a capture dialog and its parent
    settings surface can overlap during React cleanup. Releasing either owner must not briefly
    re-enable commands while the other owner still expects input to be diagnostic-only.
  */
  const token = Symbol(reason);
  controlLocks.add(token);
  return () => controlLocks.delete(token);
}

export function isControllerControlLocked() {
  return controlLocks.size > 0;
}

export function subscribeControllerRuntime(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getControllerRuntimeSnapshot() {
  return snapshot;
}

export function useControllerRuntime() {
  return useSyncExternalStore(
    subscribeControllerRuntime,
    getControllerRuntimeSnapshot,
    getControllerRuntimeSnapshot,
  );
}
