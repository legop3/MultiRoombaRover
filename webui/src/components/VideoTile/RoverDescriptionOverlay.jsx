import { useEffect, useRef, useState } from 'react';

const DISMISS_AFTER_INPUT_MS = 5000;
const LARGE_FADE_MS = 700;

export default function RoverDescriptionOverlay({
  description,
  variant = 'default',
  mobileHud = false,
  displayKey = '',
  controlIntentAt = 0,
}) {
  const [largeVisible, setLargeVisible] = useState(false);
  const [largeFading, setLargeFading] = useState(false);
  const baselineIntentRef = useRef(0);
  const fadeTimerRef = useRef(null);
  const hideTimerRef = useRef(null);

  useEffect(
    () => () => {
      clearTimeout(fadeTimerRef.current);
      clearTimeout(hideTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (variant !== 'default' || !description) {
      setLargeVisible(false);
      setLargeFading(false);
      clearTimeout(fadeTimerRef.current);
      clearTimeout(hideTimerRef.current);
      return undefined;
    }
    clearTimeout(fadeTimerRef.current);
    clearTimeout(hideTimerRef.current);
    setLargeVisible(true);
    setLargeFading(false);
    baselineIntentRef.current = Number(controlIntentAt) || 0;
    return undefined;
  }, [description, displayKey, variant]);

  useEffect(() => {
    if (variant !== 'default' || !description || !largeVisible || largeFading) return;
    const nextIntent = Number(controlIntentAt) || 0;
    if (nextIntent <= baselineIntentRef.current) return;
    if (fadeTimerRef.current || hideTimerRef.current) return;
    fadeTimerRef.current = setTimeout(() => {
      setLargeFading(true);
      fadeTimerRef.current = null;
    }, DISMISS_AFTER_INPUT_MS);
    hideTimerRef.current = setTimeout(() => {
      setLargeVisible(false);
      hideTimerRef.current = null;
    }, DISMISS_AFTER_INPUT_MS + LARGE_FADE_MS);
  }, [controlIntentAt, description, largeFading, largeVisible, variant]);

  if (!description) return null;

  if (variant === 'spectator') {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-1 z-50 flex justify-center">
        <div className="surface max-w-[92%] border border-slate-600/80 px-1 py-0.5 text-center text-[0.62rem] leading-tight text-slate-100 shadow-lg">
          {description}
        </div>
      </div>
    );
  }

  if (variant !== 'default' || !largeVisible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
      <div
        className={`surface max-w-[94%] border border-slate-400/70 bg-neutral-900/45 px-2 py-1 text-center font-semibold text-slate-100 shadow-xl transition-opacity duration-700 ${
          largeFading ? 'opacity-0' : 'opacity-100'
        } ${mobileHud ? 'text-[1rem] leading-tight' : 'text-[1.5rem] leading-tight'}`}
      >
        <p>Just so you know, this rover</p>
        <p>{description}</p>
        <p className={`${mobileHud ? 'text-[0.58rem]' : 'text-[0.72rem]'} mt-0.5 font-normal text-slate-300`}>
          This fades 5 seconds after your first control input.
        </p>
      </div>
    </div>
  );
}
