// Scanner Content
// Purpose: Provides the rover-facing IO page for the server-run barcode scanner system.
// Scope: Captures keyboard-style scanner input, emits raw scans, renders server state, and plays local beep/TTS output.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSpectatorMode } from '../../hooks/useSpectatorMode.js';
import useDefaultNickname from '../../hooks/useDefaultNickname.js';
import useUserIdentitySync from '../../hooks/useUserIdentitySync.js';
import useScannerSpeech from './useScannerSpeech.js';

const EMPTY_SCANNER_STATE = {
  beepAllowed: false,
  lastScan: null,
  registryError: null,
};

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
  const connected = useSessionSelector((state) => state.connected);
  const inputRef = useRef(null);
  const [scannerState, setScannerState] = useState(EMPTY_SCANNER_STATE);
  const [focused, setFocused] = useState(false);

  useDefaultNickname();
  useUserIdentitySync();
  useSpectatorMode();
  useScannerSpeech(scannerState.lastScan);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  useEffect(() => {
    function handleScannerState(nextState = {}) {
      setScannerState({
        ...EMPTY_SCANNER_STATE,
        ...(nextState && typeof nextState === 'object' ? nextState : {}),
      });
    }

    socket.on('barcode:state', handleScannerState);
    return () => {
      socket.off('barcode:state', handleScannerState);
    };
  }, [socket]);

  const submitScan = useCallback(() => {
    const code = String(inputRef.current?.value || '').trim();
    if (!code) {
      focusInput();
      return;
    }

    if (scannerState.beepAllowed) {
      playSubmitBeep();
    }

    // The page intentionally sends only raw scanner text. The server reloads
    // the barcode registry, resolves labels/types, applies access policy, and
    // broadcasts the display state back to every scanner page.
    socket.emit('barcode:scan', { code }, () => {});
    inputRef.current.value = '';
    focusInput();
  }, [focusInput, scannerState.beepAllowed, socket]);

  const lastScan = scannerState.lastScan;
  const label = lastScan?.label || 'waiting';
  const code = lastScan?.code || '';
  const statusText = !connected ? 'offline' : focused ? 'scanner ready' : 'click page';
  const showCode = Boolean(code && label !== 'waiting');

  return (
    <main
      className="flex min-h-screen cursor-default flex-col items-center justify-center overflow-hidden bg-black px-6 text-center text-white"
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
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          submitScan();
        }}
      />
      <section className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
        <h1 className="max-w-full break-words text-[6rem] font-black leading-none tracking-normal text-white md:text-[9rem] lg:text-[11rem]">
          {label}
        </h1>
        {showCode ? (
          <p className="mt-8 text-[3rem] font-bold leading-none tracking-normal text-white md:text-[4rem]">
            {code}
          </p>
        ) : null}
      </section>
      <footer className="flex h-20 w-full items-center justify-center text-[2rem] font-bold leading-none tracking-normal text-white">
        {statusText}
      </footer>
    </main>
  );
}
