// Vip Midi Beeper Card
// Purpose: Adds client-only MIDI file and live MIDI input playback through the existing Roomba song command path.
// Scope: Keeps MIDI parsing, Web MIDI selection, local beeper pacing, and VIP card UI isolated from the rest of the page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CardFrame from '../../CardFrame/index.jsx';
import { useControlActions } from '../../../controls/index.js';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { fieldClass } from '../constants.js';
import {
  BEEPER_READY_GUARD_MS,
  DEFAULT_ARPEGGIO_NOTE_LIMIT,
  DEFAULT_ARPEGGIO_NOTE_TICKS,
  DEFAULT_ARRANGER_DENSITY,
  DEFAULT_FILE_NOTE_TICKS,
  DEFAULT_LIVE_NOTE_TICKS,
  LIVE_DEVICE_EMPTY_VALUE,
  MAX_FILE_NOTE_TICKS,
  PLAYBACK_MODES,
  PRACTICAL_MIN_NOTE_TICKS,
} from './constants.js';
import {
  arrangeRoombaBeeperEvents,
  buildRoombaSongChunks,
  clampRoombaDurationTicks,
  clampRoombaNote,
  getDefaultSelectedPartIds,
  getPresetPartIds,
  parseMidiFile,
  roombaTicksToMs,
} from './midiBeeperUtils.js';
import StatusRow from './StatusRow.jsx';

function getNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export default function VipMidiBeeperCard() {
  const { sendSong } = useControlActions();
  const ownRoverId = useSessionSelector((state) => String(state.session?.assignment?.roverId || '').trim());

  const [selectedFileName, setSelectedFileName] = useState('');
  const [parsedMidi, setParsedMidi] = useState(null);
  const [selectedPartIds, setSelectedPartIds] = useState([]);
  const [playbackMode, setPlaybackMode] = useState('arranged');
  const [monoMaxTicks, setMonoMaxTicks] = useState(MAX_FILE_NOTE_TICKS);
  const [arpeggioNoteTicks, setArpeggioNoteTicks] = useState(DEFAULT_ARPEGGIO_NOTE_TICKS);
  const [arpeggioNoteLimit, setArpeggioNoteLimit] = useState(DEFAULT_ARPEGGIO_NOTE_LIMIT);
  const [arrangerDensity, setArrangerDensity] = useState(DEFAULT_ARRANGER_DENSITY);
  const [liveNoteTicks, setLiveNoteTicks] = useState(DEFAULT_LIVE_NOTE_TICKS);
  const [message, setMessage] = useState('');
  const [playbackState, setPlaybackState] = useState('idle');
  const [stats, setStats] = useState({ sent: 0, dropped: 0 });
  const [midiAccessState, setMidiAccessState] = useState('idle');
  const [midiInputs, setMidiInputs] = useState([]);
  const [selectedInputId, setSelectedInputId] = useState(LIVE_DEVICE_EMPTY_VALUE);
  const [liveEnabled, setLiveEnabled] = useState(false);

  const midiAccessRef = useRef(null);
  const activeInputRef = useRef(null);
  const playbackRunRef = useRef(0);
  const playbackTimersRef = useRef([]);
  const beeperBusyUntilRef = useRef(0);
  const playbackCursorMsRef = useRef(0);
  const playbackStartedAtRef = useRef(0);
  const playbackConfigRef = useRef(null);

  const playableParts = useMemo(() => parsedMidi?.parts || [], [parsedMidi]);

  const beeperOptions = useMemo(
    () => ({
      monoFallbackTicks: DEFAULT_FILE_NOTE_TICKS,
      monoMaxTicks,
      arpeggioTicks: arpeggioNoteTicks,
      arpeggioLimit: arpeggioNoteLimit,
      density: arrangerDensity,
    }),
    [arpeggioNoteLimit, arpeggioNoteTicks, arrangerDensity, monoMaxTicks],
  );

  const beeperEvents = useMemo(() => {
    if (!playableParts.length || !selectedPartIds.length) return [];
    return arrangeRoombaBeeperEvents(playableParts, selectedPartIds, playbackMode, beeperOptions);
  }, [beeperOptions, playableParts, playbackMode, selectedPartIds]);

  const songChunks = useMemo(() => buildRoombaSongChunks(beeperEvents), [beeperEvents]);

  const midiSupported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  const selectedInput = useMemo(
    () => midiInputs.find((input) => input.id === selectedInputId) || null,
    [midiInputs, selectedInputId],
  );
  const selectedPartSet = useMemo(
    () => new Set(selectedPartIds.map((id) => String(id))),
    [selectedPartIds],
  );

  useEffect(() => {
    /*
      File playback has to let settings change while a song is playing. React
      callbacks created at play-start would otherwise close over stale mode and
      channel values, so the scheduler reads the latest normalized config from a
      ref each time it reaches a chunk boundary.
    */
    playbackConfigRef.current = {
      playableParts,
      selectedPartIds,
      playbackMode,
      beeperOptions,
    };
  }, [beeperOptions, playableParts, playbackMode, selectedPartIds]);

  const clearPlaybackTimers = useCallback(() => {
    playbackTimersRef.current.forEach((timer) => clearTimeout(timer));
    playbackTimersRef.current = [];
  }, []);

  const applyPartPreset = useCallback(
    (preset) => {
      setSelectedPartIds(getPresetPartIds(playableParts, preset));
    },
    [playableParts],
  );

  const togglePart = useCallback((partId) => {
    const normalized = String(partId || '');
    if (!normalized) return;

    setSelectedPartIds((current) => {
      const currentSet = new Set(current.map((entry) => String(entry)));
      if (currentSet.has(normalized)) {
        currentSet.delete(normalized);
      } else {
        currentSet.add(normalized);
      }
      return Array.from(currentSet).sort();
    });
  }, []);

  const stopPlayback = useCallback(() => {
    /*
      Stopping playback cannot stop a note that the Roomba is already beeping.
      It only cancels future browser timers and lets the local busy clock expire
      naturally, which matches the beeper's real "no interruption" behavior.
    */
    playbackRunRef.current += 1;
    clearPlaybackTimers();
    setPlaybackState('idle');
  }, [clearPlaybackTimers]);

  const sendBeeperNote = useCallback(
    ({ note, duration, source }) => {
      const now = getNow();
      const safeDuration = clampRoombaDurationTicks(duration);

      if (!ownRoverId) {
        setMessage('Take control of your rover first.');
        setStats((prev) => ({ ...prev, dropped: prev.dropped + 1 }));
        return false;
      }

      if (now < beeperBusyUntilRef.current) {
        /*
          The server and Roomba will accept fast commands, but the Roomba song
          player drops a song while it is already playing one. This local gate
          chooses an intentional skip instead of sending a command that is very
          likely to disappear silently.
        */
        setStats((prev) => ({ ...prev, dropped: prev.dropped + 1 }));
        return false;
      }

      const sent = sendSong?.([{ note: clampRoombaNote(note), duration: safeDuration }], { slot: 0 });
      if (!sent) {
        setStats((prev) => ({ ...prev, dropped: prev.dropped + 1 }));
        return false;
      }

      beeperBusyUntilRef.current = now + roombaTicksToMs(safeDuration) + BEEPER_READY_GUARD_MS;
      setStats((prev) => ({ ...prev, sent: prev.sent + 1 }));
      if (source === 'live') {
        setMessage('Live note sent.');
      }
      return true;
    },
    [ownRoverId, sendSong],
  );

  const sendBeeperChunk = useCallback(
    (chunk) => {
      const notes = Array.isArray(chunk?.notes) ? chunk.notes : [];
      if (!notes.length) return false;

      if (!ownRoverId) {
        setMessage('Take control of your rover first.');
        setStats((prev) => ({ ...prev, dropped: prev.dropped + notes.length }));
        return false;
      }

      /*
        File playback sends a complete Roomba song definition instead of racing
        individual note commands against the beeper's busy state. The Roomba can
        play up to 16 notes from one accepted command, so the browser only has
        to time phrase boundaries instead of every single note.
      */
      const sent = sendSong?.(notes, { slot: 0 });
      if (!sent) {
        setStats((prev) => ({ ...prev, dropped: prev.dropped + notes.length }));
        return false;
      }

      beeperBusyUntilRef.current = getNow() + (Number(chunk.durationMs) || 0) + BEEPER_READY_GUARD_MS;
      setStats((prev) => ({ ...prev, sent: prev.sent + notes.length }));
      return true;
    },
    [ownRoverId, sendSong],
  );

  const buildNextPlaybackChunk = useCallback(() => {
    const config = playbackConfigRef.current || {};
    const parts = Array.isArray(config.playableParts) ? config.playableParts : [];
    const partIds = Array.isArray(config.selectedPartIds) ? config.selectedPartIds : [];
    if (!parts.length || partIds.length === 0) return null;

    const events = arrangeRoombaBeeperEvents(parts, partIds, config.playbackMode, config.beeperOptions)
      .filter((event) => event.atMs >= playbackCursorMsRef.current - 0.5);
    const chunks = buildRoombaSongChunks(events);
    return chunks[0] || null;
  }, []);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0] || null;
    stopPlayback();
    setMessage('');
    setParsedMidi(null);
    setSelectedFileName(file?.name || '');
    setSelectedPartIds([]);

    if (!file) return;

    try {
      const nextMidi = await parseMidiFile(file);
      setParsedMidi(nextMidi);
      const defaultParts = getDefaultSelectedPartIds(nextMidi.parts);
      setSelectedPartIds(defaultParts);
      setMessage(nextMidi.parts?.length ? 'Midi file loaded.' : 'Midi file loaded, but no playable parts were found.');
    } catch (err) {
      setMessage(err?.message || 'Failed to parse Midi file.');
      setSelectedFileName('');
    }
  };

  const handlePlayFile = () => {
    if (!songChunks.length) {
      setMessage('Choose at least one playable part first.');
      return;
    }
    if (!ownRoverId) {
      setMessage('Take control of your rover first.');
      return;
    }

    stopPlayback();
    setLiveEnabled(false);
    setStats({ sent: 0, dropped: 0 });
    setMessage('');
    setPlaybackState('playing');

    const runId = playbackRunRef.current + 1;
    playbackRunRef.current = runId;
    playbackStartedAtRef.current = getNow();
    playbackCursorMsRef.current = songChunks[0]?.startMs || 0;

    const scheduleNextChunk = (delayMs = 0) => {
      if (playbackRunRef.current !== runId) return;
      const timer = setTimeout(() => {
        if (playbackRunRef.current !== runId) return;
        const chunk = buildNextPlaybackChunk();
        if (!chunk) {
          setPlaybackState('idle');
          setMessage(`Playback finished in ${Math.round((getNow() - playbackStartedAtRef.current) / 1000)}s.`);
          return;
        }

        const sourceGapMs = Math.max(0, chunk.startMs - playbackCursorMsRef.current);
        if (sourceGapMs > 0) {
          /*
            Real rests are handled as source-time cursor advances. The follow-up
            timer recomputes the next chunk from the latest channel/mode
            settings instead of committing to a chunk before the silence has
            elapsed.
          */
          playbackCursorMsRef.current = chunk.startMs;
          scheduleNextChunk(sourceGapMs);
          return;
        }

        sendBeeperChunk(chunk);
        playbackCursorMsRef.current = Math.max(playbackCursorMsRef.current + 0.5, Number(chunk.sourceEndMs) || playbackCursorMsRef.current);
        scheduleNextChunk((Number(chunk.durationMs) || 0) + BEEPER_READY_GUARD_MS);
      }, Math.max(0, delayMs));
      playbackTimersRef.current.push(timer);
    };

    /*
      Chunks are scheduled one boundary at a time. Each boundary rebuilds the
      next phrase from the latest selected channels and playback settings, so
      changes made while the current Roomba song is playing affect the next
      song command without trying to interrupt the one already in the beeper.
    */
    scheduleNextChunk(0);
  };

  const refreshMidiInputs = useCallback((access) => {
    const inputs = Array.from(access?.inputs?.values?.() || []).map((input) => ({
      id: input.id,
      name: input.name || input.manufacturer || 'Midi input',
      state: input.state || 'connected',
    }));
    setMidiInputs(inputs);
    setSelectedInputId((current) => {
      if (current && inputs.some((input) => input.id === current)) return current;
      return inputs[0]?.id || LIVE_DEVICE_EMPTY_VALUE;
    });
  }, []);

  const requestMidiAccess = useCallback(async () => {
    if (!midiSupported) {
      setMidiAccessState('unsupported');
      setMessage('This browser does not support live Midi input.');
      return;
    }

    try {
      setMidiAccessState('requesting');
      const access = await navigator.requestMIDIAccess({ sysex: false });
      midiAccessRef.current = access;
      refreshMidiInputs(access);
      access.onstatechange = () => refreshMidiInputs(access);
      setMidiAccessState('ready');
      setMessage('Live Midi input ready.');
    } catch (err) {
      setMidiAccessState('error');
      setMessage(err?.message || 'Midi access was denied.');
    }
  }, [midiSupported, refreshMidiInputs]);

  useEffect(() => {
    if (!liveEnabled || !selectedInput || !midiAccessRef.current) {
      if (activeInputRef.current) {
        activeInputRef.current.onmidimessage = null;
        activeInputRef.current = null;
      }
      return undefined;
    }

    const input = midiAccessRef.current.inputs.get(selectedInput.id);
    if (!input) return undefined;

    const handleMidiMessage = (event) => {
      const [status, noteNumber, velocity] = Array.from(event.data || []);
      const command = status & 0xf0;
      const isNoteOn = command === 0x90 && velocity > 0;
      if (!isNoteOn) return;

      /*
        Live note-off messages cannot stop the Roomba beeper, so live mode uses
        fixed short notes. Users can tune that length instead of expecting MIDI
        keyboard release timing to behave like a synthesizer.
      */
      sendBeeperNote({
        note: noteNumber,
        duration: liveNoteTicks,
        source: 'live',
      });
    };

    if (activeInputRef.current && activeInputRef.current !== input) {
      activeInputRef.current.onmidimessage = null;
    }
    input.onmidimessage = handleMidiMessage;
    activeInputRef.current = input;

    return () => {
      if (input.onmidimessage === handleMidiMessage) {
        input.onmidimessage = null;
      }
    };
  }, [liveEnabled, liveNoteTicks, selectedInput, sendBeeperNote]);

  useEffect(
    () => () => {
      /*
        The user-facing stop handler updates React state, but unmount cleanup
        should only tear down external work. Incrementing the run id cancels any
        late timer callback without asking React to render a card that is going
        away.
      */
      playbackRunRef.current += 1;
      clearPlaybackTimers();
      if (activeInputRef.current) {
        activeInputRef.current.onmidimessage = null;
      }
      if (midiAccessRef.current) {
        midiAccessRef.current.onstatechange = null;
      }
    },
    [clearPlaybackTimers],
  );

  return (
    <CardFrame title="Midi Beeper">
      <div className="grid gap-1">
        {/* The file and live-input workspaces follow this card's width. A wide
            viewport must not force them beside each other inside a sidebar. */}
        <div className="grid grid-cols-1 gap-0.5 @[28rem]:grid-cols-2">
          <section className="surface h-full">
            <div className="grid h-full gap-0.5 content-start">
              <p className="text-sm text-slate-200 text-center">File playback</p>
              <label className="mx-auto grid w-full max-w-sm gap-0.5 text-xs text-slate-300 text-center">
                <span>Midi file</span>
                <input
                  className={`${fieldClass} text-center`}
                  type="file"
                  accept=".mid,.midi,audio/midi,audio/x-midi"
                  disabled={playbackState === 'playing'}
                  onChange={handleFileChange}
                />
              </label>

              <div className="mx-auto grid w-full max-w-sm gap-0.5 text-xs text-slate-300 text-center">
                <span>Parts</span>
                <div className="grid grid-cols-4 gap-0.5">
                  <button type="button" className="button-dark text-xs" disabled={!playableParts.length} onClick={() => applyPartPreset('default')}>
                    Default
                  </button>
                  <button type="button" className="button-dark text-xs" disabled={!playableParts.length} onClick={() => applyPartPreset('melody')}>
                    Melody
                  </button>
                  <button type="button" className="button-dark text-xs" disabled={!playableParts.length} onClick={() => applyPartPreset('bass')}>
                    Bass
                  </button>
                  <button type="button" className="button-dark text-xs" disabled={!playableParts.length} onClick={() => applyPartPreset('all-pitched')}>
                    Pitched
                  </button>
                </div>
                {playableParts.length ? (
                  <div className="max-h-36 overflow-y-auto rounded-md border border-neutral-700/70 bg-neutral-900/60 p-0.5">
                    <div className="grid gap-0.5">
                      {playableParts.map((part) => {
                        const checked = selectedPartSet.has(String(part.id));
                        return (
                          <label
                            key={part.id}
                            className={`surface-muted flex items-center justify-between gap-0.5 px-0.5 py-0.5 ${
                              checked ? 'text-emerald-200' : 'text-slate-400'
                            }`}
                            title={part.sourceLabel || part.label}
                          >
                            <span className="flex min-w-0 items-center gap-0.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePart(part.id)}
                              />
                              <span className="truncate text-left">{part.label}</span>
                            </span>
                            <span className="shrink-0 text-[0.65rem] text-slate-400">
                              {part.isPercussion ? 'drums' : `${part.noteCount} notes`}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="surface-muted text-xs text-slate-500">No playable parts</div>
                )}
                <button type="button" className="button-dark mx-auto text-xs" disabled={!playableParts.length} onClick={() => applyPartPreset('none')}>
                  Clear parts
                </button>
              </div>

              <label className="mx-auto grid w-full max-w-sm gap-0.5 text-xs text-slate-300 text-center">
                <span>Playback mode</span>
                <select
                  className={fieldClass}
                  value={playbackMode}
                  onChange={(event) => setPlaybackMode(event.target.value === 'arpeggio' ? 'arpeggio' : 'mono')}
                >
                  {PLAYBACK_MODES.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mx-auto grid w-full max-w-sm gap-0.5 text-xs text-slate-300 text-center">
                <span>Playback shape</span>
                <div className="grid grid-cols-2 gap-0.5 @sm:grid-cols-4">
                  <label className="grid gap-0.5">
                    <span>Max note</span>
                    <input
                      className={fieldClass}
                      type="number"
                      min={PRACTICAL_MIN_NOTE_TICKS}
                      max="96"
                      value={monoMaxTicks}
                      onChange={(event) => {
                        const next = Math.max(PRACTICAL_MIN_NOTE_TICKS, clampRoombaDurationTicks(Number(event.target.value) || MAX_FILE_NOTE_TICKS));
                        setMonoMaxTicks(next);
                      }}
                    />
                  </label>
                  <label className="grid gap-0.5">
                    <span>Arp note</span>
                    <input
                      className={fieldClass}
                      type="number"
                      min={PRACTICAL_MIN_NOTE_TICKS}
                      max="32"
                      value={arpeggioNoteTicks}
                      onChange={(event) => {
                        const next = Math.max(PRACTICAL_MIN_NOTE_TICKS, clampRoombaDurationTicks(Number(event.target.value) || DEFAULT_ARPEGGIO_NOTE_TICKS));
                        setArpeggioNoteTicks(next);
                      }}
                    />
                  </label>
                  <label className="grid gap-0.5">
                    <span>Arp parts</span>
                    <input
                      className={fieldClass}
                      type="number"
                      min="1"
                      max="16"
                      value={arpeggioNoteLimit}
                      onChange={(event) => {
                        const next = Math.max(1, Math.min(16, Math.round(Number(event.target.value) || DEFAULT_ARPEGGIO_NOTE_LIMIT)));
                        setArpeggioNoteLimit(next);
                      }}
                    />
                  </label>
                  <label className="grid gap-0.5">
                    <span>Density</span>
                    <input
                      className={fieldClass}
                      type="number"
                      min="1"
                      max="5"
                      value={arrangerDensity}
                      onChange={(event) => {
                        const next = Math.max(1, Math.min(5, Math.round(Number(event.target.value) || DEFAULT_ARRANGER_DENSITY)));
                        setArrangerDensity(next);
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="mx-auto w-full max-w-sm text-center">
                {selectedFileName ? (
                  <div className="surface-muted text-xs text-slate-300">{selectedFileName}</div>
                ) : (
                  <div className="surface-muted text-xs text-slate-500">No Midi file selected</div>
                )}
              </div>

              <div className="flex justify-center gap-0.5">
                <button
                  type="button"
                  className="button-dark text-sm"
                  disabled={!ownRoverId || !beeperEvents.length || playbackState === 'playing'}
                  onClick={handlePlayFile}
                >
                  Play file
                </button>
                <button
                  type="button"
                  className="button-danger text-sm"
                  disabled={playbackState !== 'playing'}
                  onClick={stopPlayback}
                >
                  Stop
                </button>
              </div>
            </div>
          </section>

          <section className="surface h-full">
            <div className="grid h-full gap-0.5 grid-rows-[auto_auto_auto_1fr]">
              <p className="text-sm text-slate-200 text-center">Live input</p>
              <div className="flex justify-center">
                <button
                  type="button"
                  className="button-dark text-sm"
                  disabled={!midiSupported || midiAccessState === 'requesting'}
                  onClick={requestMidiAccess}
                >
                  {midiAccessState === 'ready' ? 'Refresh devices' : 'Enable Midi'}
                </button>
              </div>

              <label className="mx-auto grid w-full max-w-sm gap-0.5 text-xs text-slate-300 text-center">
                <span>Input device</span>
                <select
                  className={fieldClass}
                  value={selectedInputId}
                  disabled={midiAccessState !== 'ready' || liveEnabled}
                  onChange={(event) => setSelectedInputId(event.target.value)}
                >
                  {midiInputs.length ? null : <option value={LIVE_DEVICE_EMPTY_VALUE}>No devices</option>}
                  {midiInputs.map((input) => (
                    <option key={input.id} value={input.id}>
                      {input.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mx-auto grid w-full max-w-sm gap-0.5 text-xs text-slate-300 text-center">
                <span>Live note length</span>
                <input
                  className={fieldClass}
                  type="number"
                  min="1"
                  max="32"
                  value={liveNoteTicks}
                  onChange={(event) => setLiveNoteTicks(clampRoombaDurationTicks(Number(event.target.value) || DEFAULT_LIVE_NOTE_TICKS))}
                />
              </label>

              <label className="surface-muted mx-auto flex w-full max-w-sm items-center justify-center gap-0.5 px-0.5 py-0.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={liveEnabled}
                  disabled={!ownRoverId || midiAccessState !== 'ready' || !selectedInput}
                  onChange={(event) => {
                    setLiveEnabled(Boolean(event.target.checked));
                    setStats({ sent: 0, dropped: 0 });
                    setMessage(event.target.checked ? 'Live Midi input enabled.' : 'Live Midi input disabled.');
                  }}
                />
                <span>Live beeper input</span>
              </label>
            </div>
          </section>
        </div>

        <section className="surface">
          <div className="space-y-0.5">
            <p className="text-sm text-slate-200 text-center">Beeper status</p>
            {/* Status stays legible as a short vertical list in slim cards, then
                returns to the normal six-value strip as soon as 28rem is available. */}
            <div className="grid grid-cols-1 gap-0.5 @xs:grid-cols-2 @[28rem]:grid-cols-6">
              <StatusRow label="Rover" value={ownRoverId || 'none'} active={Boolean(ownRoverId)} />
              <StatusRow label="File state" value={playbackState} active={playbackState === 'playing'} />
              <StatusRow label="Parts" value={selectedPartIds.length || 'none'} active={selectedPartIds.length > 0} />
              <StatusRow label="Live input" value={liveEnabled ? 'enabled' : midiAccessState} active={liveEnabled} />
              <StatusRow label="Notes sent" value={stats.sent} active={stats.sent > 0} />
              <StatusRow label="Notes skipped" value={stats.dropped} active={stats.dropped === 0} />
            </div>
            {message ? <div className="text-xs text-slate-400 text-center">{message}</div> : null}
          </div>
        </section>
      </div>
    </CardFrame>
  );
}
