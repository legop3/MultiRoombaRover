import { useEffect, useState } from 'react';

const LARGE_VISIBLE_MS = 6000;
const LARGE_FADE_MS = 700;

export default function RoverDescriptionOverlay({
  description,
  variant = 'default',
  mobileHud = false,
  displayKey = '',
}) {
  const [largeVisible, setLargeVisible] = useState(false);
  const [largeFading, setLargeFading] = useState(false);

  useEffect(() => {
    if (variant !== 'default' || !description) {
      setLargeVisible(false);
      setLargeFading(false);
      return undefined;
    }
    setLargeVisible(true);
    setLargeFading(false);
    const fadeTimer = setTimeout(() => setLargeFading(true), LARGE_VISIBLE_MS);
    const hideTimer = setTimeout(() => setLargeVisible(false), LARGE_VISIBLE_MS + LARGE_FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [description, displayKey, variant]);

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
    <div className="pointer-events-none absolute inset-x-0 top-2 z-50 flex justify-center">
      <div
        className={`surface max-w-[94%] border border-slate-500/85 px-2 py-1 text-center font-semibold text-slate-100 shadow-2xl transition-opacity duration-700 ${
          largeFading ? 'opacity-0' : 'opacity-100'
        } ${mobileHud ? 'text-[1rem] leading-tight' : 'text-[1.5rem] leading-tight'}`}
      >
        <p>Just so you know, this rover</p>
        {description}
      </div>
    </div>
  );
}
