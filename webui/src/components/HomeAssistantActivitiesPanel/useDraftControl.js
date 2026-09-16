// Number/text drafts are local until the short pause expires. HA broadcasts
// cannot erase unfinished typing. After sending, the reported state owns the UI.
import { useCallback, useEffect, useRef, useState } from 'react';

export default function useDraftControl(onChange, disabled) {
  const [draft, setDraft] = useState(null);
  const timer = useRef(null);
  const change = useRef(onChange);
  // A compound action may receive newer companion values while this field is
  // being typed. Use the current handler when the pause ends, not a snapshot
  // captured when the timer started.
  useEffect(() => { change.current = onChange; }, [onChange]);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // A lock, disconnect, or unmount cancels queued edits. Unlocking must never
  // replay a change that was typed before permission was removed.
  useEffect(() => cancel, [cancel, disabled]);

  const commit = useCallback((value) => {
    cancel();
    if (disabled) return;
    // Sending ends the local edit, not a request/response transaction. The
    // next HA broadcast updates this input just like any external change.
    change.current(value);
    setDraft(null);
  }, [disabled, cancel]);

  const edit = (value, debounce = true) => {
    cancel();
    setDraft(value);
    if (debounce && !disabled) timer.current = setTimeout(() => commit(value), 650);
  };
  return { draft, edit, commit, cancel };
}
