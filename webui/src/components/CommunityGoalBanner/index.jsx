import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../../context/SessionContext.jsx';

const MOBILE_DISMISS_MS = 10000;
const MAX_FONT_PX = 28;
const MIN_FONT_PX = 14;

export default function CommunityGoalBanner({ layout = 'desktop', className = '', dismissable = true }) {
  const { session } = useSession();
  const goalText = session?.communityGoal?.text ? String(session.communityGoal.text).trim() : '';
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
        'panel-section flex w-full items-center justify-center',
        isMobile ? 'rounded-none' : 'rounded',
        'px-1 py-1 text-center font-semibold tracking-tight',
        className,
      ]
        .filter(Boolean)
        .join(' '),
    [className, isMobile],
  );

  if (!goalText || !visible) return null;

  const remainingSeconds = isMobile ? Math.ceil(remainingMs / 1000) : null;

  const dismissProps = dismissable
    ? { onClick: () => setVisible(false), role: 'button', tabIndex: 0 }
    : {};

  return (
    <div
      ref={containerRef}
      className={containerClass}
      style={{ fontSize: `${fontSize}px`, lineHeight: 1.1 }}
      {...dismissProps}
    >
      <span className="flex w-full items-stretch gap-0.5 whitespace-nowrap rounded-md">
        <span className="flex flex-col justify-center border-r border-slate-700/60 px-0.5 text-[0.55em] font-semibold leading-tight text-slate-400">
          <span>Community</span>
          <span>Goal</span>
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
