// Scanner Content
// Purpose: Provides the rover-facing IO page for the server-run barcode scanner system.
// Scope: Captures keyboard-style scanner input, emits raw scans, renders server state, and plays local beep/TTS output.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSpectatorMode } from '../../hooks/useSpectatorMode.js';
import useDefaultNickname from '../../hooks/useDefaultNickname.js';
import useUserIdentitySync from '../../hooks/useUserIdentitySync.js';
import SocketConnectionPill from '../../components/SocketConnectionPill/index.jsx';
import useBarcodeGameState from '../../barcodeGames/useBarcodeGameState.js';
import useScannerSpeech from './useScannerSpeech.js';
import { trackAnalyticsEvent, trackAnalyticsEventThrottled } from '../../analytics/index.js';

const EMPTY_SCANNER_STATE = {
  beepAllowed: false,
  lastScan: null,
  registryError: null,
};
const SCANNER_STATE_STALE_MS = 10 * 1000;
const SCANNER_RESUBSCRIBE_MS = 5 * 1000;

function useClock(enabled) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return now;
}

function formatTimer(endsAt, now) {
  if (!Number.isFinite(endsAt)) return '';
  const totalSeconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}

function getSectionItemText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  return String(item.label || item.value || item.text || '').trim();
}

function normalizeDisplaySections(sections) {
  if (!Array.isArray(sections)) return [];

  // The scanner screen is intentionally a dumb renderer: games describe their
  // own rich status through display.sections, and this page only normalizes the
  // shape enough to avoid crashing on a malformed server payload. That keeps
  // game-specific logic out of the rover-facing IO page.
  return sections
    .map((section) => ({
      title: String(section?.title || '').trim(),
      items: Array.isArray(section?.items)
        ? section.items
            .map((item) => ({
              text: getSectionItemText(item),
              status: typeof item === 'object' && item ? item.status : null,
            }))
            .filter((item) => item.text)
        : [],
    }))
    .filter((section) => section.title || section.items.length)
    .slice(0, 3);
}

function playSubmitBeep() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  // The beep is deliberately short and loud because it confirms that the scan
  // computer submitted input. It is not tied to success; success/failure comes
  // back from the server as the large display text and spoken label.
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(980, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.95, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.22);
  oscillator.onended = () => {
    audioContext.close().catch(() => {});
  };
}

export default function ScannerContent() {
  const socket = useSocket();
  const inputRef = useRef(null);
  const flashTimerRef = useRef(null);
  const scannerReadyTrackedRef = useRef(false);
  const [scannerState, setScannerState] = useState(EMPTY_SCANNER_STATE);
  const [scannerConnectionState, setScannerConnectionState] = useState({
    connected: Boolean(socket.connected),
    stale: true,
    lastReceivedAt: null,
  });
  const [scanAudioEvent, setScanAudioEvent] = useState(null);
  const [flashActive, setFlashActive] = useState(false);
  const { state: barcodeGameState, connectionState: barcodeGameConnectionState } = useBarcodeGameState();

  useDefaultNickname();
  useUserIdentitySync();
  useSpectatorMode();
  useScannerSpeech(scannerState.lastScan, scanAudioEvent);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  useEffect(() => {
    return () => {
      window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let staleTimer = null;
    let retryTimer = null;
    let lastReceivedAt = 0;

    function handleScannerState(nextState = {}) {
      if (disposed) return;
      lastReceivedAt = Date.now();
      if (!scannerReadyTrackedRef.current) {
        scannerReadyTrackedRef.current = true;
        trackAnalyticsEvent('scanner_route_ready', {
          beepAllowed: Boolean(nextState?.beepAllowed),
        });
      }
      setScannerState({
        ...EMPTY_SCANNER_STATE,
        ...(nextState && typeof nextState === 'object' ? nextState : {}),
      });
      setScannerConnectionState({
        connected: Boolean(socket.connected),
        stale: false,
        lastReceivedAt,
      });
    }

    function handleScanAudio(payload = null) {
      setScanAudioEvent(payload && typeof payload === 'object' ? payload : null);
      trackAnalyticsEvent('barcode_scan_audio_play', {
        hasPayload: Boolean(payload && typeof payload === 'object'),
      });
    }

    function subscribeToScannerState() {
      // The scan input path is intentionally independent from display state, so
      // the page can beep/flash even if it missed a previous status broadcast.
      // This subscribe is idempotent and gives the rover-facing page a way to
      // repair its display after reconnects or quiet periods.
      socket.emit('barcode:subscribe', {}, (response = {}) => {
        if (response.state) {
          handleScannerState(response.state);
          return;
        }
        setScannerConnectionState((previous) => ({
          ...previous,
          connected: Boolean(socket.connected),
          stale: !lastReceivedAt,
        }));
      });
    }

    function handleConnect() {
      setScannerConnectionState((previous) => ({
        ...previous,
        connected: true,
        stale: !lastReceivedAt,
      }));
      subscribeToScannerState();
    }

    function handleDisconnect() {
      setScannerConnectionState((previous) => ({
        ...previous,
        connected: false,
        stale: true,
      }));
    }

    socket.on('barcode:state', handleScannerState);
    socket.on('barcode:scanAudio', handleScanAudio);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    subscribeToScannerState();

    staleTimer = window.setInterval(() => {
      const isStale = !lastReceivedAt || Date.now() - lastReceivedAt > SCANNER_STATE_STALE_MS;
      if (isStale && lastReceivedAt) {
        trackAnalyticsEventThrottled(
          'scanner_state_stale',
          { connected: Boolean(socket.connected) },
          { key: `scanner_state_stale:${Boolean(socket.connected)}`, throttleMs: 60 * 1000 },
        );
      }
      setScannerConnectionState((previous) => ({
        ...previous,
        connected: Boolean(socket.connected),
        stale: isStale,
      }));
    }, 1000);

    retryTimer = window.setInterval(() => {
      if (!socket.connected) return;
      if (!lastReceivedAt || Date.now() - lastReceivedAt > SCANNER_STATE_STALE_MS) {
        subscribeToScannerState();
      }
    }, SCANNER_RESUBSCRIBE_MS);

    return () => {
      disposed = true;
      window.clearInterval(staleTimer);
      window.clearInterval(retryTimer);
      socket.off('barcode:state', handleScannerState);
      socket.off('barcode:scanAudio', handleScanAudio);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket]);

  const submitScan = useCallback(() => {
    const code = String(inputRef.current?.value || '').trim();
    if (!code) {
      focusInput();
      return;
    }

    if (scannerState.beepAllowed) {
      // The flash is paired with the local submit beep so rovers get an
      // immediate visual confirmation that the scanner computer accepted input.
      // It is intentionally not a success indicator; the server result still
      // arrives separately as the resolved text and spoken label.
      window.clearTimeout(flashTimerRef.current);
      setFlashActive(true);
      flashTimerRef.current = window.setTimeout(() => {
        setFlashActive(false);
      }, 120);
      playSubmitBeep();
    }

    // The page intentionally sends only raw scanner text. The server reloads
    // the barcode registry, resolves labels/types, applies access policy, and
    // broadcasts the display state back to every scanner page.
    trackAnalyticsEvent('barcode_scan_submit', {
      length: code.length,
      beepAllowed: scannerState.beepAllowed,
    });
    socket.emit('barcode:scan', { code }, () => {});
    inputRef.current.value = '';
    focusInput();
  }, [focusInput, scannerState.beepAllowed, socket]);

  const lastScan = scannerState.lastScan;
  const activeGame = barcodeGameState.activeGame;
  const display = activeGame?.display || {};
  const timerEndsAt = display.timer?.endsAt;
  const now = useClock(Number.isFinite(timerEndsAt));
  const timerText = formatTimer(timerEndsAt, now);
  const showGameDisplay = activeGame?.status && activeGame.status !== 'idle';
  // Idle game state is useful for the Activities panel, but the scanner page's
  // normal job is still showing the resolved barcode text. Only active lifecycle
  // states take over the large rover-facing display.
  const title = showGameDisplay ? display.title || activeGame?.title || 'Barcode games' : lastScan?.label || 'Waiting';
  const label = showGameDisplay ? display.primary || '' : '';
  const secondary = showGameDisplay ? display.secondary || '' : '';
  const displaySections = showGameDisplay ? normalizeDisplaySections(display.sections) : [];
  const participants = Array.isArray(barcodeGameState.participants) ? barcodeGameState.participants : [];
  const syncMessage = !scannerConnectionState.connected
    ? 'scanner offline'
    : scannerConnectionState.stale || barcodeGameConnectionState.stale
      ? 'syncing'
      : '';

  return (
    <main
      className={`flex min-h-screen cursor-default flex-col items-center justify-center overflow-hidden px-6 text-center ${
        flashActive ? 'bg-white text-black' : 'bg-black text-white'
      }`}
      onClick={focusInput}
    >
      <input
        ref={inputRef}
        aria-label="barcode scanner input"
        className="absolute left-0 top-0 h-px w-px opacity-0"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          submitScan();
        }}
      />
      <section className="flex min-h-screen w-full items-center justify-center">
        <div className="flex max-w-full flex-col items-center gap-[3vh]">
          <h1 className="max-w-full break-words text-[17vw] font-black leading-none tracking-normal">
            {title}
          </h1>
          <p className="max-w-full break-words text-[6vw] font-bold leading-tight tracking-normal">
            {label}
          </p>
          {secondary ? (
            <p className="max-w-full break-words text-[4vw] font-bold leading-tight tracking-normal">
              {secondary}
            </p>
          ) : null}
          {displaySections.length ? (
            <div className="flex max-w-full flex-col items-center gap-[1vh]">
              {displaySections.map((section, sectionIndex) => (
                <div key={`${section.title || 'section'}-${sectionIndex}`} className="max-w-full">
                  {section.title ? (
                    <p className="text-[2.6vw] font-bold leading-tight tracking-normal opacity-80">
                      {section.title}
                    </p>
                  ) : null}
                  <div className="flex max-w-full flex-col items-center gap-[0.4vh]">
                    {section.items.slice(0, 8).map((item, itemIndex) => (
                      <p
                        key={`${item.text}-${itemIndex}`}
                        className={`max-w-full break-words text-[3.1vw] leading-tight tracking-normal ${
                          item.status === 'active'
                            ? 'font-black'
                            : item.status === 'complete'
                              ? 'font-semibold opacity-45'
                              : 'font-bold opacity-85'
                        }`}
                      >
                        {item.text}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {timerText ? (
            <p className="font-mono text-[7vw] font-black leading-none tracking-normal">
              {timerText}
            </p>
          ) : null}
          {participants.length ? (
            <p className="max-w-full truncate text-[3vw] font-semibold leading-tight tracking-normal">
              {participants.map((participant) => participant.nickname || participant.roverId).filter(Boolean).join(' / ')}
            </p>
          ) : null}
        </div>
      </section>
      {syncMessage ? (
        <div className="absolute bottom-4 left-4 text-left text-[2.5vw] font-bold leading-none tracking-normal opacity-80 md:text-xl">
          {syncMessage}
        </div>
      ) : null}
      <SocketConnectionPill />
    </main>
  );
}
