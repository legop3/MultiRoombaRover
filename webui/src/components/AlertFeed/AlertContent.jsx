import ChatMessageRow from '../ChatMessageRow/index.jsx';
import ButtonBoxTile from '../ButtonBoxTile/index.jsx';

function getSafeWikiUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return '';

  try {
    /*
      Wiki links are operator-authored registry data, but this still normalizes
      them before rendering an anchor. Allowing only http/https avoids turning a
      barcode registry typo into a javascript: link while still supporting both
      absolute URLs and local wiki paths such as /wiki/object-name.
    */
    const parsed = new URL(text, window.location.origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function BarcodeScanToast({ payload }) {
  const wikiUrl = getSafeWikiUrl(payload?.wikiUrl);
  const label = payload?.label || payload?.code || 'unknown barcode';

  return (
    <div className="pointer-events-auto max-w-[80vw] rounded-md bg-neutral-800 px-2 py-1 text-l leading-tight text-slate-100">
      <style>
        {`
          @keyframes barcode-wiki-flat-flash {
            0%, 100% {
              background: rgb(233, 186, 14);
              color: rgb(71, 144, 253);
            }
            50% {
              background: rgb(125, 49, 255);
              color: rgb(246, 250, 211);
            }
          }
        `}
      </style>
      <p className="flex flex-wrap items-center gap-0.5 text-slate-100">
        <span className="font-semibold text-slate-300 pr-1">Barcode scanned:</span>
        <span className="font-semibold text-white">{label}</span>
        {wikiUrl ? (
          <a
            href={wikiUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md ml-0.5 px-2 py-1 text-xl font-semibold leading-tight tracking-normal"
            style={{ animation: 'barcode-wiki-flat-flash 0.35s steps(1, end) infinite' }}
          >
            Wiki link
          </a>
        ) : null}
      </p>
    </div>
  );
}

function UndockedExitWarningToast() {
  return (
    <div
      className="w-[min(32rem,80vw)] rounded-md bg-amber-950 px-4 py-3 text-left text-amber-50"
      role="alert"
    >
      <p className="text-xl font-bold leading-tight text-amber-100">Please dock your rover</p>
      <p className="mt-1 text-base font-medium leading-snug text-amber-50/90">
        Your rover is still undocked. Please dock it before leaving the page.
      </p>
    </div>
  );
}

export default function AlertContent({ alert }) {
  if (alert.kind === 'buttonbox-active' && alert.payload) {
    const payload = alert.payload;
    return (
      <div className={`pointer-events-none w-50 max-w-full rounded-md ${payload.limited ? 'bg-red-950' : 'bg-cyan-900'}`}>
        <ButtonBoxTile
          buttonId={payload.buttonId}
          count={payload.count}
          goal={payload.goal}
          rewardNumber={payload.rewardNumber}
          rewardName={payload.rewardName}
          rewardDescription={payload.rewardDescription}
          dailyCount={payload.dailyCount}
          dailyLimit={payload.dailyLimit}
          limited={payload.limited}
          className={payload.limited ? 'bg-red-950 ring-1 ring-red-500/70' : 'bg-cyan-900'}
        />
        {payload.description ? (
          <p className={['mt-1 text-center text-xs font-semibold', payload.limited ? 'text-red-200' : 'text-cyan-100'].join(' ')}>
            {payload.description}
          </p>
        ) : null}
      </div>
    );
  }
  if (alert.kind === 'chat' && alert.payload) {
    return <ChatMessageRow message={alert.payload} />;
  }
  if (alert.kind === 'chat-typing' && alert.payload) {
    return (
      // Override only the feed's typing surface so whole-alert opacity has one owner.
      <div className="[&>div]:bg-slate-900 [&>div]:opacity-100">
        <ChatMessageRow message={alert.payload} variant="typing" />
      </div>
    );
  }
  if (alert.kind === 'barcode-scan' && alert.payload) {
    return <BarcodeScanToast payload={alert.payload} />;
  }
  if (alert.kind === 'undocked-exit-warning') {
    return <UndockedExitWarningToast />;
  }
  const color = typeof alert.color === 'string' ? alert.color.trim() : '';
  const backgroundColor = /^#?[0-9a-f]{6}$/i.test(color) ? `#${color.replace('#', '')}` : '#2196f3';

  return (
    <div
      className="pointer-events-auto min-w-0 max-w-96 rounded-md px-2 py-1 text-left text-[0.72rem] leading-tight text-white"
      style={{ backgroundColor: `color-mix(in srgb, ${backgroundColor} 65%, black)` }}
    >
      <p className="truncate">
        <span className="font-semibold">{alert.title || 'Alert'}</span>
        <span className="text-white/70"> · </span>
        <span className="text-white">{alert.message}</span>
      </p>
    </div>
  );
}
