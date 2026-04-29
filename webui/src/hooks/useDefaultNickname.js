// Hook: useDefaultNickname
// Purpose: Computes and applies fallback nickname behavior for unauthenticated/new sessions. Scope: Wraps nickname initialization policy and side effects.
import { useEffect, useRef } from 'react';
import { useSettingsNamespace } from '../settings/index.js';
import { useSessionActions } from '../context/SessionContext.jsx';
import wordListText from '../assets/wordlist.txt?raw';

function capitalize(word) {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function pickRandomWord() {
  const words = String(wordListText || '')
    .split(/\r?\n/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (!words.length) return '';
  const selected = words[Math.floor(Math.random() * words.length)] || '';
  return selected.trim();
}

export default function useDefaultNickname() {
  const { setNickname } = useSessionActions();
  const { value, status, save } = useSettingsNamespace('profile', { nickname: '' });
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (status !== 'ready') return;
    if (attemptedRef.current) return;

    const existing = (value.nickname || '').trim();
    if (existing) return;

    attemptedRef.current = true;
    const generated = capitalize(pickRandomWord()).slice(0, 32);
    if (!generated) return;

    const applyNickname = async () => {
      try {
        await setNickname(generated);
      } catch (err) {
        // Ignore server errors; still persist locally to avoid re-rolling.
      } finally {
        save({ nickname: generated });
      }
    };

    applyNickname();
  }, [save, setNickname, status, value.nickname]);
}
