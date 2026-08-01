// Driver Ad Card
// Purpose: Renders the optional server-configured advertisement in the desktop
// driver column. Scope: This component owns presentation and self-gating only;
// the server remains the source of both the title and trusted HTML markup.
import CardFrame from '../CardFrame/index.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';

export default function DriverAdCard({ className = '' }) {
  const driverAd = useSessionSelector((state) => state.session?.driverAd || null);
  const title = typeof driverAd?.title === 'string' ? driverAd.title : '';
  const html = typeof driverAd?.html === 'string' ? driverAd.html.trim() : '';

  /*
    The HTML value is the feature gate. A configured title without content
    should not reserve desktop space or display an empty CardFrame.
  */
  if (!html) return null;

  return (
    <CardFrame
      title={title}
      /*
        The card owns its full-width media surface, while each layout owns
        placement such as desktop auto-spacing or mode-gate centering. This
        keeps one ad renderer reusable without baking either location into it.
      */
      className={`w-full shrink-0 ${className}`}
      bodyClassName="w-full overflow-hidden p-0"
    >
      {/*
        This markup is deliberately not sanitized: the requested contract is
        trusted HTML authored by the server operator. Anyone allowed to edit
        server configuration must therefore be treated as having control over
        content rendered in connected driver browsers.

        React's inner-HTML insertion renders markup such as links, images, and
        iframes, but browsers do not normally execute script elements inserted
        this way. Providers that require a script loader need a separate,
        explicit integration rather than silently changing this contract.
      */}
      {/*
        The slot deliberately imposes no rules on the operator-authored child
        markup. Images, iframes, or more complex embeds keep their own sizing
        contract instead of inheriting assumptions from one ad provider.
      */}
      <div className="w-full" dangerouslySetInnerHTML={{ __html: html }} />
    </CardFrame>
  );
}
