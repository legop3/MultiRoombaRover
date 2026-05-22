// Global Objective Banner
// Purpose: Defines the Global Objective Banner module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';

const MOBILE_DISMISS_MS = 10000;
const MAX_FONT_PX = 28;
const MIN_FONT_PX = 14;

function hexToRgb(hex) {
  const raw = String(hex || '').trim();
  const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function rgba(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export default function GlobalObjectiveBanner({ layout = 'desktop', className = '', dismissable = true }) {
  const goalText = useSessionSelector((state) => {
    const text = state.session?.globalObjective?.text;
    return text ? String(text).trim() : '';
  });
  const ownRoverColor = useSessionSelector((state) => {
    const roverId = String(state.session?.assignment?.roverId || '').trim();
    if (!roverId) return null;
    const roster = Array.isArray(state.session?.roster) ? state.session.roster : [];
    const rover = roster.find((entry) => String(entry?.id) === roverId);
    return rover?.color || null;
  });
  const isMobile = layout === 'mobile-portrait' || layout === 'mobile-landscape' || layout === 'mobile';
  const [visible, setVisible] = useState(false);
  const [fontSize, setFontSize] = useState(MAX_FONT_PX);
  const [remainingMs, setRemainingMs] = useState(0);
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const textContainerRef = useRef(null);

  useEffect(() => {
    if (!goalText) {
      setVisible(false);
      return undefined;
    }
    setVisible(true);
    if (!isMobile || !dismissable) return undefined;
    const startedAt = Date.now();
    setRemainingMs(MOBILE_DISMISS_MS);
    const timer = setTimeout(() => setVisible(false), MOBILE_DISMISS_MS);
    const tick = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setRemainingMs(Math.max(0, MOBILE_DISMISS_MS - elapsed));
    }, 250);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [goalText, isMobile]);

  useEffect(() => {
    if (!goalText) return undefined;
    setFontSize(MAX_FONT_PX);
    let rafId = 0;
    const adjustFont = () => {
      const textContainer = textContainerRef.current;
      const text = textRef.current;
      if (!textContainer || !text) return;
      const available = textContainer.clientWidth;
      if (!available) return;
      const needed = text.scrollWidth;
      if (!needed) return;
      const scale = Math.min(1, available / needed);
      const nextSize = Math.max(MIN_FONT_PX, Math.floor(MAX_FONT_PX * scale));
      setFontSize(nextSize);
    };
    rafId = window.requestAnimationFrame(adjustFont);
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(adjustFont);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [goalText]);

  const containerClass = useMemo(
    () =>
      [
        'panel-section flex w-full items-center justify-center border border-neutral-500/60 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_10px_24px_rgba(0,0,0,0.28)]',
        isMobile ? 'rounded-none' : 'rounded',
        'px-1 py-1 text-center font-semibold tracking-tight',
        className,
      ]
        .filter(Boolean)
        .join(' '),
    [className, isMobile],
  );
  const accentRgb = hexToRgb(ownRoverColor);
  const frameStyle = accentRgb
    ? {
        borderColor: rgba(accentRgb, 0.35),
        backgroundImage: `linear-gradient(90deg, rgba(23,23,23,0.96) 0%, rgba(38,38,38,0.94) 58%, ${rgba(accentRgb, 0.18)} 100%)`,
      }
    : undefined;

  if (!goalText || !visible) return null;

  const remainingSeconds = isMobile ? Math.ceil(remainingMs / 1000) : null;

  const dismissProps = dismissable
    ? { onClick: () => setVisible(false), role: 'button', tabIndex: 0 }
    : {};

  return (
    <div
      ref={containerRef}
      className={containerClass}
      style={{ ...(frameStyle || {}), fontSize: `${fontSize}px`, lineHeight: 1.1 }}
      {...dismissProps}
    >
      <span className="flex w-full items-stretch gap-0.5 whitespace-nowrap rounded-md">
        <span className="flex flex-col justify-center border-r border-slate-700/60 px-0.5 text-[0.55em] font-semibold leading-tight text-slate-400">
          <span>Global</span>
          <span>Objective</span>
        </span>
        <span ref={textContainerRef} className="flex-1 overflow-hidden text-slate-100">
          <span ref={textRef} className="block">
            {goalText}
          </span>
        </span>
        {isMobile ? (
          <span className="flex items-center border-l border-slate-700/60 px-0.5 text-[0.55em] font-semibold uppercase tracking-wide text-slate-400">
            {remainingSeconds}s
          </span>
        ) : null}
      </span>
    </div>
  );
}
