// Auto Fit Text
// Purpose: Defines the Auto Fit Text module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useLayoutEffect, useRef, useState } from 'react';

export default function AutoFitText({ children, className = '', maxSize = 1000, minSize = 14, style = undefined }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return undefined;

    let raf = null;
    const fit = () => {
      const width = container.clientWidth;
      if (!width) {
        scheduleFit();
        return;
      }
      let low = minSize;
      let high = maxSize;
      let best = minSize;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        textEl.style.fontSize = `${mid}px`;
        const fits = textEl.scrollWidth <= width;
        if (fits) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      setFontSize(best);
    };

    const scheduleFit = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };

    scheduleFit();
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [children, maxSize, minSize]);

  return (
    <div ref={containerRef} className="w-full min-w-0">
      <div
        ref={textRef}
        className={`whitespace-nowrap ${className}`}
        style={{ fontSize: `${fontSize}px`, lineHeight: 1.1, ...(style || {}) }}
      >
        {children}
      </div>
    </div>
  );
}
