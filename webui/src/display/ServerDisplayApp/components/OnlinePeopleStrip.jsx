// Online People Strip
// Purpose: Renders a one-line, label-free list of online people for the room display.
// Scope: Owns overflow detection and marquee-style motion without changing shared user-list components.
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUserName } from '../utils.js';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

export default function OnlinePeopleStrip({ users = [] }) {
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const contentRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  const names = useMemo(
    () =>
      users
        // The display page itself enters spectator mode, and other passive
        // spectators are usually not relevant to people physically in the room.
        // Filtering them keeps the top strip focused on active participants.
        .filter((user) => user?.role !== 'spectator')
        .map(formatUserName)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [users],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return undefined;

    const updateOverflow = () => {
      // The strip only moves when it needs to. A still row is easier to read
      // when the current online set already fits on the 16:10 display.
      setOverflowing(content.scrollWidth > viewport.clientWidth + 4);
    };

    updateOverflow();
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);
    return () => resizeObserver.disconnect();
  }, [names]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !overflowing) return undefined;

    // This animation is local to the display route, so it is created directly
    // on the strip element instead of adding route-specific keyframes to the
    // global stylesheet. The duplicated name row means -50% lands exactly at
    // the start of the second copy, producing a continuous readable loop.
    const animation = track.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }],
      { duration: 42000, iterations: Infinity, easing: 'linear' },
    );
    return () => animation.cancel();
  }, [overflowing, names]);

  const renderedNames = names.length ? names : ['No one online'];
  const itemNodes = renderedNames.map((name, index) => (
    <span key={`${name}-${index}`} className="shrink-0 px-[1.6vw] font-black tracking-normal text-slate-100">
      {name}
    </span>
  ));

  return (
    <div ref={viewportRef} className="relative h-full min-w-0 overflow-hidden border-b border-slate-800/80 bg-black">
      <div
        ref={trackRef}
        className={classNames(
          'flex h-full w-max items-center whitespace-nowrap text-[clamp(2.5rem,5.3vh,5.8rem)] leading-none',
        )}
      >
        <div ref={contentRef} className="flex h-full items-center">
          {itemNodes}
        </div>
        {overflowing ? (
          // The duplicate row makes the loop continuous. It is hidden from assistive
          // tech because it is purely mechanical animation, not extra information.
          <div className="flex h-full items-center" aria-hidden="true">
            {itemNodes}
          </div>
        ) : null}
      </div>
    </div>
  );
}
