// Deterrence Chaos
// Purpose: Defines the Deterrence Chaos module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';

function getRandomElement(elements) {
  if (!elements || !elements.length) return null;
  const idx = Math.floor(Math.random() * elements.length);
  return elements[idx] || null;
}

function corruptDomOnce() {
  if (typeof document === 'undefined' || !document.body) return;
  const elements = document.body.getElementsByTagName('*');
  if (!elements || elements.length < 2) return;

  const sourceA = getRandomElement(elements);
  const targetA = getRandomElement(elements);
  const classA = sourceA?.classList?.[0] || null;
  if (classA && targetA?.classList) {
    try {
      targetA.classList.add(classA);
    } catch {
      // Best-effort chaos; ignore invalid class token failures.
    }
  }

  const sourceB = getRandomElement(elements);
  const targetB = getRandomElement(elements);
  const classB = sourceB?.classList?.[1] || null;
  if (classB && targetB?.classList) {
    try {
      targetB.classList.add(classB);
    } catch {
      // Best-effort chaos; ignore invalid class token failures.
    }
  }
}

export default function DeterrenceChaos() {
  const isDeterred = useSessionSelector((state) => Boolean(state.session?.moderation?.isDeterred));

  useEffect(() => {
    if (!isDeterred) return undefined;
    const timer = window.setInterval(() => {
      corruptDomOnce();
    }, 1);
    return () => {
      window.clearInterval(timer);
    };
  }, [isDeterred]);

  return null;
}
