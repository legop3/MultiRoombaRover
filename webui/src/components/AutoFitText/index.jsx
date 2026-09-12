// Auto Fit Text
// Purpose: Sizes one unwrapped label to the largest font that fits its container.
// Scope: Supports the existing width-only labels and full-box overlays from one shared implementation.
import { useLayoutEffect, useRef, useState } from 'react';

export default function AutoFitText({
  children,
  className = '',
  containerClassName = '',
  maxSize = 1000,
  minSize = 14,
  fitHeight = false,
  style = undefined,
}) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return undefined;

    let animationFrame = null;
    const fit = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || (fitHeight && !height)) {
        scheduleFit();
        return;
      }

      // Binary search avoids stepping through hundreds of possible font sizes.
      // Overlay labels test both axes; ordinary rover labels preserve their
      // previous width-only behavior so this shared move changes no layout.
      let low = minSize;
      let high = maxSize;
      let best = minSize;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        textEl.style.fontSize = `${middle}px`;
        const fitsWidth = textEl.scrollWidth <= width;
        const fitsHeight = !fitHeight || textEl.scrollHeight <= height;
        if (fitsWidth && fitsHeight) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      setFontSize(best);
    };

    const scheduleFit = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(fit);
    };

    scheduleFit();
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container);
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [children, fitHeight, maxSize, minSize]);

  return (
    <div
      ref={containerRef}
      className={`${fitHeight ? 'flex h-full items-center justify-center' : ''} w-full min-w-0 ${containerClassName}`}
    >
      <div
        ref={textRef}
        className={`whitespace-nowrap ${className}`}
        style={{ fontSize: `${fontSize}px`, lineHeight: fitHeight ? 1 : 1.1, ...(style || {}) }}
      >
        {children}
      </div>
    </div>
  );
}
