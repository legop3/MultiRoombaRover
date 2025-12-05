import { useMemo } from 'react';
import { formatKeyLabel } from '../controls/keymapUtils.js';
import { getHelpContent } from '../help/content.js';

function KeyPill({ actionId, keymap }) {
  const value = keymap?.[actionId]?.[0] ?? '';
  return (
    <span className="rounded border border-slate-600 bg-slate-900/40 px-1 text-[0.7rem] text-slate-200">
      {formatKeyLabel(value)}
    </span>
  );
}

function renderSegments(segments, keymap) {
  return segments.map((segment, idx) => {
    if (typeof segment === 'string') {
      return <span key={`text-${idx}`}>{segment}</span>;
    }
    if (segment?.action) {
      return <KeyPill key={`pill-${segment.action}-${idx}`} actionId={segment.action} keymap={keymap} />;
    }
    if (segment?.text) {
      return <span key={`span-${idx}`}>{segment.text}</span>;
    }
    return null;
  });
}

function renderLine(line, keymap, idx) {
  if (typeof line === 'string') return line;
  if (Array.isArray(line?.segments)) return renderSegments(line.segments, keymap);
  if (line && typeof line === 'object') {
    // Fallback: render any stray object as text if possible
    if (typeof line.text === 'string') return line.text;
    if (Array.isArray(line)) return renderSegments(line, keymap);
  }
  return String(line ?? '');
}

function Hero({ hero, keymap }) {
  if (!hero) return null;
  return (
    <div className="surface space-y-0.25 px-0.5 py-0.5">
      <div className="flex flex-wrap items-center justify-between gap-0.5">
        <div>
          <p className="text-sm font-semibold text-white">{hero.title}</p>
          {hero.subtitle && <p className="text-xs text-slate-300">{hero.subtitle}</p>}
        </div>
        {hero.chips && (
          <div className="flex flex-wrap gap-0.25 text-[0.7rem] text-slate-200">
            {hero.chips.map((chip) => (
              <span key={chip} className="rounded border border-slate-700 px-1 py-[2px]">
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>
      {hero.bullets && (
        <ul className="space-y-0.25 text-[0.85rem] text-slate-200">
          {hero.bullets.map((line, idx) => {
            const key = Array.isArray(line?.segments) ? `hero-${idx}` : `hero-${idx}`;
            return (
              <li key={key} className="surface-muted px-0.5 py-0.25">
                {renderLine(line, keymap, idx)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ListBlock({ block, keymap }) {
  return (
    <div className="space-y-0.25">
      <p className="text-xs font-semibold text-slate-200">{block.title}</p>
      <ul className="space-y-0.25 text-[0.8rem] text-slate-300">
        {block.items.map((item, idx) => {
          const key = `item-${idx}`;
          return (
            <li key={key} className="surface-muted flex flex-wrap items-center gap-0.25 px-0.5 py-0.25">
              {renderLine(item, keymap, idx)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CalloutBlock({ block }) {
  const toneClass = block.tone === 'info' ? 'border-cyan-500/40' : 'border-slate-700';
  return (
    <div className={`surface space-y-0.25 border ${toneClass} px-0.5 py-0.5`}>
      <p className="text-xs font-semibold text-slate-100">{block.title}</p>
      {block.body && (
        <ul className="space-y-0.25 text-[0.8rem] text-slate-300">
          {block.body.map((line, idx) => (
            <li key={`callout-${idx}`} className="surface-muted px-0.5 py-0.25">
              {renderLine(line, {})}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KeyboardGroup({ group, keymap }) {
  return (
    <div className="space-y-0.25 surface">
      <p className="px-0.5 py-0.25 text-[0.75rem] font-semibold text-slate-200">{group.title}</p>
      <div className="space-y-0.25 px-0.5 pb-0.25">
        {group.items.map((item) => (
          <div key={item.action} className="surface-muted flex items-center justify-between gap-0.5 px-0.5 py-0.25 text-[0.8rem]">
            <span className="text-slate-200">{item.label}</span>
            <KeyPill actionId={item.action} keymap={keymap} />
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyboardBlock({ block, keymap }) {
  if (!block) return null;
  return (
    <div className="space-y-0.25">
      <div className="flex items-center justify-between text-xs text-slate-200">
        <span className="font-semibold">{block.title}</span>
        {block.footnote && <span className="text-[0.7rem] text-slate-400">{block.footnote}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0.5">
        {block.groups?.map((group) => (
          <KeyboardGroup key={group.id} group={group} keymap={keymap} />
        ))}
      </div>
    </div>
  );
}

function GamepadBlock({ block }) {
  if (!block) return null;
  return (
    <div className="space-y-0.25">
      <p className="text-xs font-semibold text-slate-200">{block.title}</p>
      <ul className="space-y-0.25 text-[0.8rem] text-slate-300">
        {block.items?.map((line, idx) => (
          <li key={`gamepad-${idx}`} className="surface-muted px-0.5 py-0.25">
            {renderLine(line, {})}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlockRenderer({ block, keymap }) {
  if (!block) return null;
  switch (block.type) {
    case 'list':
      return <ListBlock block={block} keymap={keymap} />;
    case 'callout':
      return <CalloutBlock block={block} />;
    case 'keyboard':
      return <KeyboardBlock block={block} keymap={keymap} />;
    case 'gamepad':
      return <GamepadBlock block={block} />;
    default:
      return null;
  }
}

export function HelpContentView({ layout, keymap }) {
  const content = useMemo(() => getHelpContent(layout), [layout]);
  const bindings = keymap || {};
  const mainBlocks = content.main || [];
  const asideBlocks = content.aside || [];

  return (
    <div className="space-y-0.5">
      <Hero hero={content.hero} keymap={bindings} />
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}
      >
        <div className="space-y-0.5">
          {mainBlocks.map((block, idx) => (
            <BlockRenderer key={block.title || idx} block={block} keymap={bindings} />
          ))}
        </div>
        <div className="space-y-0.5">
          {asideBlocks.map((block, idx) => (
            <BlockRenderer key={block.title || idx} block={block} keymap={bindings} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default HelpContentView;
