// Analytics Reporter
// Purpose: Publishes page/session context to the optional build-time analytics
// adapter. Scope: observes route, layout, nickname, role, verification, and
// rover assignment without owning any analytics vendor implementation.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSessionSelector } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import { identifyAnalyticsSession, trackAnalyticsEvent } from './index.js';

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
  const location = useLocation();
  const layout = useAnalyticsLayout();
  const { value: profile } = useSettingsNamespace('profile', { nickname: '' });
  const session = useSessionSelector((state) => state.session);
  const previousRouteRef = useRef(null);
  const previousLayoutRef = useRef(null);
  const previousRoverRef = useRef(null);
  const previousIdentityRef = useRef('');
  const route = location.pathname || '/';
  const nickname = String(profile?.nickname || session?.nickname || '').trim();
  const roverId = String(session?.assignment?.roverId || '').trim();
  const role = String(session?.role || '').trim();
  const verified = Boolean(session?.isVerified);

  const identity = useMemo(
    () => ({
      route,
      layout,
      nickname,
      hasNickname: Boolean(nickname),
      roverId,
      assignedRover: Boolean(roverId),
      role,
      verified,
    }),
    [layout, nickname, role, route, roverId, verified],
  );

  useEffect(() => {
    const serialized = JSON.stringify(identity);
    if (previousIdentityRef.current === serialized) return;
    previousIdentityRef.current = serialized;

    /*
      This pushes the current browser/session context into the injected adapter.
      The adapter is responsible for applying build-time privacy/config choices,
      such as whether nickname and rover id should be sent to Umami.
    */
    identifyAnalyticsSession(identity);
  }, [identity]);

  useEffect(() => {
    if (previousRouteRef.current === route) return;
    previousRouteRef.current = route;
    trackAnalyticsEvent('route_enter', { route, layout });
  }, [layout, route]);

  useEffect(() => {
    if (previousLayoutRef.current === layout) return;
    previousLayoutRef.current = layout;
    trackAnalyticsEvent('layout_change', { route, layout });
  }, [layout, route]);

  useEffect(() => {
    if (!roverId || previousRoverRef.current === roverId) return;
    previousRoverRef.current = roverId;
    trackAnalyticsEvent('rover_assigned', { roverId, route, layout });
  }, [layout, route, roverId]);

  return null;
}
