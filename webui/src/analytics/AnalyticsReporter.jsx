// Analytics Reporter
// Purpose: Publishes page/session context to the optional runtime analytics
// adapter. Scope: observes route, layout, nickname, role, verification, and
// rover assignment without owning any analytics vendor implementation.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionSelector } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import { identifyAnalyticsSession } from './index.js';

function detectLayout() {
  if (typeof window === 'undefined') return 'desktop';
  if (window.innerWidth >= 1024) return 'desktop';
  return window.innerWidth > window.innerHeight ? 'mobile-landscape' : 'mobile-portrait';
}

function useAnalyticsLayout() {
  const [layout, setLayout] = useState(() => detectLayout());

  useEffect(() => {
    function updateLayout() {
      setLayout(detectLayout());
    }

    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  return layout;
}

export default function AnalyticsReporter() {
  const layout = useAnalyticsLayout();
  const { value: profile } = useSettingsNamespace('profile', { nickname: '' });
  const session = useSessionSelector((state) => state.session);
  const previousIdentityRef = useRef('');
  const nickname = String(profile?.nickname || session?.nickname || '').trim();
  const roverId = String(session?.assignment?.roverId || '').trim();
  const role = String(session?.role || '').trim();
  const verified = Boolean(session?.isVerified);

  const identity = useMemo(
    () => ({
      layout,
      hasNickname: Boolean(nickname),
      roverId,
      assignedRover: Boolean(roverId),
      role,
      verified,
    }),
    [layout, nickname, role, roverId, verified],
  );

  useEffect(() => {
    const serialized = JSON.stringify(identity);
    if (previousIdentityRef.current === serialized) return;
    previousIdentityRef.current = serialized;

    /*
      Session properties describe durable segmentation dimensions. Route is
      intentionally absent because Umami attaches the current URL to pageviews
      and events automatically, and nickname is reduced to a non-identifying
      boolean so aggregate analytics does not store user-entered names.
    */
    identifyAnalyticsSession(identity);
  }, [identity]);

  return null;
}
