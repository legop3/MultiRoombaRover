// Midi Beeper utilities
// Purpose: Parses MIDI files into simple beeper note events and converts timing into Roomba song units.
// Scope: Pure helpers only; React state, browser MIDI input, and command sending live in the card component.
import { parseMidi } from 'midi-file';
import {
  DEFAULT_ARPEGGIO_NOTE_TICKS,
  DEFAULT_ARPEGGIO_NOTE_LIMIT,
  DEFAULT_ARRANGER_DENSITY,
  DEFAULT_FILE_NOTE_TICKS,
  FILE_CHUNK_GAP_THRESHOLD_MS,
  MAX_FILE_NOTE_TICKS,
  PRACTICAL_MIN_NOTE_TICKS,
  ROOMBA_SONG_MAX_NOTES,
  ROOMBA_DURATION_TICK_MS,
  ROOMBA_NOTE_MAX,
  ROOMBA_NOTE_MIN,
} from './constants.js';

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

export function clampRoombaNote(note) {
  return clamp(Math.round(note), ROOMBA_NOTE_MIN, ROOMBA_NOTE_MAX);
}

export function clampRoombaDurationTicks(ticks) {
  return clamp(Math.round(ticks), 1, 255);
}

function clampPracticalDurationTicks(ticks) {
  return clamp(Math.round(ticks), PRACTICAL_MIN_NOTE_TICKS, 255);
}

export function roombaTicksToMs(ticks) {
  return clampRoombaDurationTicks(ticks) * ROOMBA_DURATION_TICK_MS;
}

function formatTrackLabel(index, name, noteCount, channels = []) {
  const cleanName = String(name || '').trim();
  const prefix = cleanName || `Track ${index + 1}`;
  const channelLabel = channels.length > 1 ? `, ${channels.length} channels` : channels.length === 1 ? ', 1 channel' : '';
  return `${prefix} (${noteCount} notes${channelLabel})`;
}

function collectAbsoluteEvents(track = []) {
  let tick = 0;
  return track.map((event) => {
    tick += Number(event?.deltaTime) || 0;
    return { ...event, absoluteTick: tick };
  });
}

function createTempoMap(parsed) {
  const tempoEvents = [];

  /*
    MIDI tempo is global for normal format-1 files, and tempo events often sit
    in track 0 while the notes live in a later track. Reading tempo changes from
    every track gives selected-track playback the same timing map without
    requiring server work or a heavier sequencer library.
  */
  (parsed?.tracks || []).forEach((track) => {
    collectAbsoluteEvents(track).forEach((event) => {
      if (event.type !== 'setTempo') return;
      tempoEvents.push({
        tick: event.absoluteTick,
        microsecondsPerBeat: Number(event.microsecondsPerBeat) || 500000,
      });
    });
  });

  tempoEvents.sort((a, b) => a.tick - b.tick);
  if (!tempoEvents.length || tempoEvents[0].tick !== 0) {
    tempoEvents.unshift({ tick: 0, microsecondsPerBeat: 500000 });
  }

  return tempoEvents;
}

function tickToMs(tick, tempoMap, ticksPerBeat) {
  let elapsedMs = 0;
  let previousTick = 0;
  let microsecondsPerBeat = 500000;

  /*
    Tempo changes are piecewise-linear: each segment uses the tempo active at
    the start of that segment. This loop is intentionally small and direct
    because MIDI files for this feature are expected to be short, and clarity is
    more important than caching every possible tick conversion.
  */
  for (const tempo of tempoMap) {
    if (tempo.tick > tick) break;
    const deltaTicks = Math.max(0, tempo.tick - previousTick);
    elapsedMs += (deltaTicks / ticksPerBeat) * (microsecondsPerBeat / 1000);
    previousTick = tempo.tick;
    microsecondsPerBeat = tempo.microsecondsPerBeat;
  }

  const remainingTicks = Math.max(0, tick - previousTick);
  return elapsedMs + (remainingTicks / ticksPerBeat) * (microsecondsPerBeat / 1000);
}

function extractTrackNotes(track = [], tempoMap, ticksPerBeat) {
  const absoluteEvents = collectAbsoluteEvents(track);
  const activeNotes = new Map();
  const notes = [];
  let trackName = '';

  absoluteEvents.forEach((event) => {
    if (event.type === 'trackName' && event.text) {
      trackName = String(event.text);
      return;
    }

    if (event.type !== 'noteOn' && event.type !== 'noteOff') return;

    const channel = Number(event.channel) || 0;
    const noteNumber = Number(event.noteNumber);
    if (!Number.isFinite(noteNumber)) return;
    const key = `${channel}:${noteNumber}`;
    const velocity = Number(event.velocity) || 0;
    const isNoteStart = event.type === 'noteOn' && velocity > 0;

    if (isNoteStart) {
      /*
        A repeated note-on for the same note/channel before note-off is unusual
        but possible. Replacing the active note keeps the parser from creating a
        negative or huge duration if the file is messy.
      */
      activeNotes.set(key, {
        channel,
        noteNumber,
        startTick: event.absoluteTick,
        velocity,
      });
      return;
    }

    const active = activeNotes.get(key);
    if (!active) return;
    activeNotes.delete(key);

    const startMs = tickToMs(active.startTick, tempoMap, ticksPerBeat);
    const endMs = tickToMs(event.absoluteTick, tempoMap, ticksPerBeat);
    notes.push({
      channel: active.channel,
      noteNumber: active.noteNumber,
      velocity: active.velocity,
      startMs,
      durationMs: Math.max(ROOMBA_DURATION_TICK_MS, endMs - startMs),
    });
  });

  notes.sort((a, b) => a.startMs - b.startMs || b.noteNumber - a.noteNumber);
  return { trackName, notes };
}

function summarizeChannels(notes = []) {
  const counts = new Map();

  notes.forEach((note) => {
    const channel = Number(note?.channel);
    if (!Number.isInteger(channel)) return;
    const previous = counts.get(channel) || {
      noteCount: 0,
      minNote: 127,
      maxNote: 0,
      noteTotal: 0,
    };
    previous.noteCount += 1;
    previous.minNote = Math.min(previous.minNote, Number(note.noteNumber) || previous.minNote);
    previous.maxNote = Math.max(previous.maxNote, Number(note.noteNumber) || previous.maxNote);
    previous.noteTotal += Number(note.noteNumber) || 0;
    counts.set(channel, previous);
  });

  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([channel, summary]) => ({
      channel,
      noteCount: summary.noteCount,
      minNote: summary.minNote,
      maxNote: summary.maxNote,
      averageNote: summary.noteCount > 0 ? summary.noteTotal / summary.noteCount : 0,
      // MIDI channels are zero-based in the file data, but musicians and most
      // MIDI tools display them as 1-16. Keeping both avoids off-by-one logic in
      // the UI and makes channel 10 percussion obvious.
      label: `Ch ${channel + 1}`,
      isPercussion: channel === 9,
    }));
}

function buildPartSourceLabel(track, channelInfo) {
  const trackName = String(track?.name || '').trim();
  const trackLabel = trackName || `Track ${Number(track?.index || 0) + 1}`;
  const channelLabel = channelInfo?.label || `Ch ${Number(channelInfo?.channel || 0) + 1}`;
  return `${trackLabel} - ${channelLabel}`;
}

function buildPlayableParts(tracks = []) {
  const parts = [];

  tracks.forEach((track) => {
    (track.channels || []).forEach((channelInfo) => {
      const notes = (track.notes || []).filter((note) => Number(note.channel) === Number(channelInfo.channel));
      if (!notes.length) return;
      const trackName = String(track?.name || '').trim();
      const partNumber = parts.length + 1;
      const visibleLabel = trackName ? `Part ${partNumber}: ${trackName}` : `Part ${partNumber}`;

      /*
        A "part" is the user-facing musical unit. Internally it is still the
        MIDI file's track+channel pair, because that is the only reliable way to
        separate instruments across the inconsistent MIDI files people upload.
      */
      parts.push({
        id: `${track.index}:${channelInfo.channel}`,
        trackIndex: track.index,
        channel: channelInfo.channel,
        label: visibleLabel,
        sourceLabel: buildPartSourceLabel(track, channelInfo),
        shortLabel: `${Number(track.index) + 1}.${Number(channelInfo.channel) + 1}`,
        noteCount: notes.length,
        minNote: channelInfo.minNote,
        maxNote: channelInfo.maxNote,
        averageNote: channelInfo.averageNote,
        isPercussion: Boolean(channelInfo.isPercussion),
        role: inferPartRole(channelInfo),
        notes: notes.map((note) => ({
          ...note,
          partId: `${track.index}:${channelInfo.channel}`,
        })),
      });
    });
  });

  return parts.sort((a, b) => {
    if (a.isPercussion !== b.isPercussion) return a.isPercussion ? 1 : -1;
    return b.noteCount - a.noteCount || a.trackIndex - b.trackIndex || a.channel - b.channel;
  });
}

function inferPartRole(channelInfo) {
  if (channelInfo?.isPercussion) return 'drums';
  const average = Number(channelInfo?.averageNote) || 0;
  const max = Number(channelInfo?.maxNote) || 0;

  /*
    MIDI files do not reliably tell us instrument intent, so this is deliberately
    heuristic. Low average pitch behaves well as bass, high maximum pitch often
    carries melody, and everything else becomes harmony/fill material.
  */
  if (average > 0 && average < 52) return 'bass';
  if (max >= 72 || average >= 64) return 'melody';
  return 'harmony';
}

export function getDefaultSelectedPartIds(parts = []) {
  const playable = Array.isArray(parts) ? parts : [];
  const pitchedParts = playable.filter((part) => !part.isPercussion);
  const candidates = pitchedParts.length ? pitchedParts : playable;

  /*
    Default to a small, useful ensemble instead of everything. Dense MIDI files
    can overwhelm a one-note Roomba beeper, so selecting the largest pitched
    parts gives the user a recognizable starting point while keeping drums off
    unless the file has nothing else.
  */
  return candidates.slice(0, 6).map((part) => part.id);
}

export function getPresetPartIds(parts = [], preset = 'default') {
  const playable = Array.isArray(parts) ? parts : [];
  const pitchedParts = playable.filter((part) => !part.isPercussion);
  const source = pitchedParts.length ? pitchedParts : playable;

  switch (preset) {
    case 'none':
      return [];
    case 'all-pitched':
      return source.map((part) => part.id);
    case 'bass': {
      const sorted = [...source].sort((a, b) => a.averageNote - b.averageNote || b.noteCount - a.noteCount);
      return sorted.slice(0, 2).map((part) => part.id);
    }
    case 'melody': {
      const sorted = [...source].sort((a, b) => b.averageNote - a.averageNote || b.noteCount - a.noteCount);
      return sorted.slice(0, 3).map((part) => part.id);
    }
    default:
      return getDefaultSelectedPartIds(playable);
  }
}

export function collectNotesForParts(parts = [], selectedPartIds = []) {
  if (!Array.isArray(parts) || !Array.isArray(selectedPartIds) || selectedPartIds.length === 0) return [];
  const selected = new Set(selectedPartIds.map((id) => String(id)));
  return parts
    .filter((part) => selected.has(String(part.id)))
    .flatMap((part) => part.notes || [])
    .sort((a, b) => a.startMs - b.startMs || b.velocity - a.velocity || b.noteNumber - a.noteNumber);
}

function groupNotesByStart(notes = []) {
  const groups = [];
  let current = null;

  notes.forEach((note) => {
    /*
      A tiny tolerance catches chord notes that quantize to the same musical
      time but differ by a fraction of a millisecond after tempo conversion.
    */
    if (!current || Math.abs(note.startMs - current.startMs) > 1) {
      current = { startMs: note.startMs, notes: [] };
      groups.push(current);
    }
    current.notes.push(note);
  });

  return groups;
}

function groupNotesForArrangement(notes = [], toleranceMs = 24) {
  const groups = [];
  let current = null;

  notes.forEach((note) => {
    if (!current || Math.abs(note.startMs - current.startMs) > toleranceMs) {
      current = { startMs: note.startMs, notes: [] };
      groups.push(current);
    }
    current.notes.push(note);
  });

  return groups;
}

function noteDurationToRoombaTicks(note, fallbackTicks, maxTicks) {
  const naturalTicks = note.durationMs / ROOMBA_DURATION_TICK_MS;
  const cap = clampPracticalDurationTicks(maxTicks || MAX_FILE_NOTE_TICKS);
  return clampPracticalDurationTicks(Math.min(cap, naturalTicks || fallbackTicks));
}

export function filterNotesByChannels(notes = [], selectedChannels = []) {
  if (!Array.isArray(selectedChannels) || selectedChannels.length === 0) return [];
  const channelSet = new Set(selectedChannels.map((channel) => Number(channel)));
  return notes.filter((note) => channelSet.has(Number(note?.channel)));
}

export function buildBeeperEvents(notes = [], mode = 'mono', options = {}) {
  const groups = groupNotesByStart(notes);
  const events = [];
  const arpeggioTicks = clampPracticalDurationTicks(options.arpeggioTicks || DEFAULT_ARPEGGIO_NOTE_TICKS);
  const arpeggioLimit = clamp(Math.round(options.arpeggioLimit || DEFAULT_ARPEGGIO_NOTE_LIMIT), 1, 16);
  const monoFallbackTicks = clampPracticalDurationTicks(options.monoFallbackTicks || DEFAULT_FILE_NOTE_TICKS);
  const monoMaxTicks = clampPracticalDurationTicks(options.monoMaxTicks || MAX_FILE_NOTE_TICKS);

  groups.forEach((group) => {
    const playableNotes = [...group.notes].sort((a, b) => {
      /*
        Higher velocity usually represents the melody or accented chord tone.
        Note number breaks ties so dense chords become predictable instead of
        depending on the file's internal event order.
      */
      return b.velocity - a.velocity || b.noteNumber - a.noteNumber;
    });

    if (mode === 'arpeggio') {
      playableNotes.slice(0, arpeggioLimit).forEach((note, index) => {
        const ticks = arpeggioTicks;
        events.push({
          atMs: group.startMs + index * roombaTicksToMs(ticks),
          note: clampRoombaNote(note.noteNumber),
          duration: ticks,
        });
      });
      return;
    }

    const selected = playableNotes[0];
    if (!selected) return;
    events.push({
      atMs: selected.startMs,
      note: clampRoombaNote(selected.noteNumber),
      duration: noteDurationToRoombaTicks(selected, monoFallbackTicks, monoMaxTicks),
    });
  });

  return events.sort((a, b) => a.atMs - b.atMs || b.note - a.note);
}

function sortBestLeadNotes(a, b) {
  return b.velocity - a.velocity || b.noteNumber - a.noteNumber;
}

function sortBestBassNotes(a, b) {
  return b.velocity - a.velocity || a.noteNumber - b.noteNumber;
}

function chooseBestNote(notes = [], role = 'melody') {
  if (!notes.length) return null;
  const sorted = [...notes].sort(role === 'bass' ? sortBestBassNotes : sortBestLeadNotes);
  return sorted[0] || null;
}

function selectedPartsById(parts = [], selectedPartIds = []) {
  const selected = new Set((selectedPartIds || []).map((id) => String(id)));
  return (parts || []).filter((part) => selected.has(String(part.id)));
}

function makeEvent(note, atMs, durationTicks) {
  return {
    atMs,
    note: clampRoombaNote(note.noteNumber),
    duration: clampPracticalDurationTicks(durationTicks),
    partId: note.partId || '',
  };
}

function suppressNoisyRepeats(events = [], minGapMs) {
  const lastByNote = new Map();
  return events.filter((event) => {
    const key = event.note;
    const lastAt = lastByNote.get(key);
    if (typeof lastAt === 'number' && event.atMs - lastAt < minGapMs) {
      return false;
    }
    lastByNote.set(key, event.atMs);
    return true;
  });
}

export function arrangeRoombaBeeperEvents(parts = [], selectedPartIds = [], mode = 'arranged', options = {}) {
  const selectedParts = selectedPartsById(parts, selectedPartIds).filter((part) => !part.isPercussion);
  const fallbackParts = selectedParts.length ? selectedParts : selectedPartsById(parts, selectedPartIds);
  const notes = fallbackParts
    .flatMap((part) => part.notes || [])
    .sort((a, b) => a.startMs - b.startMs || b.velocity - a.velocity || b.noteNumber - a.noteNumber);

  if (!notes.length) return [];

  const density = clamp(Math.round(options.density || DEFAULT_ARRANGER_DENSITY), 1, 5);
  const monoFallbackTicks = clampPracticalDurationTicks(options.monoFallbackTicks || DEFAULT_FILE_NOTE_TICKS);
  const monoMaxTicks = clampPracticalDurationTicks(options.monoMaxTicks || MAX_FILE_NOTE_TICKS);
  const arpeggioTicks = clampPracticalDurationTicks(options.arpeggioTicks || DEFAULT_ARPEGGIO_NOTE_TICKS);
  const arpeggioLimit = clamp(Math.round(options.arpeggioLimit || DEFAULT_ARPEGGIO_NOTE_LIMIT), 1, 16);
  const groups = groupNotesForArrangement(notes, density >= 4 ? 36 : 24);
  const partCountCap = Math.max(1, Math.min(arpeggioLimit, fallbackParts.length || arpeggioLimit));
  const events = [];
  let lastBassAt = -Infinity;
  let groupIndex = 0;

  groups.forEach((group) => {
    const byPart = new Map();
    group.notes.forEach((note) => {
      const partId = String(note.partId || '');
      if (!partId) return;
      if (!byPart.has(partId)) byPart.set(partId, []);
      byPart.get(partId).push(note);
    });

    if (mode === 'arpeggio') {
      const onePerPart = Array.from(byPart.entries())
        .map(([partId, partNotes]) => {
          const part = fallbackParts.find((entry) => String(entry.id) === partId);
          return {
            part,
            note: chooseBestNote(partNotes, part?.role === 'bass' ? 'bass' : 'melody'),
          };
        })
        .filter((entry) => entry.note)
        .sort((a, b) => {
          const roleRank = { bass: 0, harmony: 1, melody: 2, drums: 3 };
          return (roleRank[a.part?.role] ?? 2) - (roleRank[b.part?.role] ?? 2) || b.note.velocity - a.note.velocity;
        });

      onePerPart.slice(0, partCountCap).forEach((entry, index) => {
        events.push(makeEvent(entry.note, group.startMs + index * roombaTicksToMs(arpeggioTicks), arpeggioTicks));
      });
      return;
    }

    const bassNotes = [];
    const melodyNotes = [];
    const harmonyNotes = [];

    group.notes.forEach((note) => {
      const part = fallbackParts.find((entry) => String(entry.id) === String(note.partId || ''));
      if (part?.role === 'bass') {
        bassNotes.push(note);
      } else if (part?.role === 'harmony') {
        harmonyNotes.push(note);
      } else {
        melodyNotes.push(note);
      }
    });

    const leadNote = chooseBestNote(melodyNotes.length ? melodyNotes : group.notes, 'melody');
    if (leadNote) {
      events.push(makeEvent(leadNote, group.startMs, noteDurationToRoombaTicks(leadNote, monoFallbackTicks, monoMaxTicks)));
    }

    if (mode === 'arranged') {
      const bassSpacingMs = density >= 4 ? 320 : density >= 3 ? 460 : 700;
      const shouldAddBass = bassNotes.length && group.startMs - lastBassAt >= bassSpacingMs;
      if (shouldAddBass) {
        const bassNote = chooseBestNote(bassNotes, 'bass');
        if (bassNote) {
          events.push(makeEvent(bassNote, group.startMs + roombaTicksToMs(arpeggioTicks), Math.max(arpeggioTicks, 6)));
          lastBassAt = group.startMs;
        }
      }

      const shouldAddHarmony = density >= 4 || (density >= 3 && groupIndex % 2 === 0);
      if (shouldAddHarmony && harmonyNotes.length) {
        const harmonyNote = chooseBestNote(harmonyNotes, 'melody');
        if (harmonyNote) {
          events.push(makeEvent(harmonyNote, group.startMs + roombaTicksToMs(arpeggioTicks) * 2, arpeggioTicks));
        }
      }
    }

    groupIndex += 1;
  });

  const repeatGapMs = density >= 4 ? 55 : density >= 3 ? 80 : 120;
  return suppressNoisyRepeats(events, repeatGapMs).sort((a, b) => a.atMs - b.atMs || b.note - a.note);
}

function createChunk(startMs) {
  return {
    startMs,
    notes: [],
    durationMs: 0,
    sourceEndMs: startMs,
  };
}

export function buildRoombaSongChunks(events = []) {
  const chunks = [];
  const sortedEvents = [...events].sort((a, b) => a.atMs - b.atMs || b.note - a.note);
  let chunk = null;
  let cursorMs = 0;

  sortedEvents.forEach((event) => {
    const noteDurationMs = roombaTicksToMs(event.duration);
    const hasOpenChunk = Boolean(chunk && chunk.notes.length > 0);
    const gapAfterCurrentChunk = hasOpenChunk ? event.atMs - cursorMs : 0;
    const shouldStartNewChunk =
      !hasOpenChunk ||
      chunk.notes.length >= ROOMBA_SONG_MAX_NOTES ||
      gapAfterCurrentChunk > FILE_CHUNK_GAP_THRESHOLD_MS;

    if (shouldStartNewChunk) {
      /*
        A new chunk is scheduled at the MIDI event time when there is real
        silence before it. If the incoming event overlaps the previous phrase,
        it starts at the current serialized cursor instead so playback bends
        toward "play the next note" instead of "drop the next note".
      */
      const startMs = Math.max(event.atMs, cursorMs);
      chunk = createChunk(startMs);
      chunks.push(chunk);
      cursorMs = startMs;
    }

    const safeNote = {
      note: clampRoombaNote(event.note),
      duration: clampRoombaDurationTicks(event.duration),
    };

    chunk.notes.push(safeNote);
    chunk.durationMs += noteDurationMs;
    chunk.sourceEndMs = chunk.startMs + chunk.durationMs;
    cursorMs += noteDurationMs;
  });

  return chunks;
}

export async function parseMidiFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseMidi(bytes);
  const ticksPerBeat = Number(parsed?.header?.ticksPerBeat || parsed?.header?.timeDivision || 0);
  if (!ticksPerBeat || ticksPerBeat < 0) {
    throw new Error('Only beat-based MIDI timing is supported.');
  }

  const tempoMap = createTempoMap(parsed);
  const tracks = (parsed.tracks || []).map((track, index) => {
    const extracted = extractTrackNotes(track, tempoMap, ticksPerBeat);
    const channels = summarizeChannels(extracted.notes);
    return {
      index,
      name: extracted.trackName,
      label: formatTrackLabel(index, extracted.trackName, extracted.notes.length, channels),
      notes: extracted.notes,
      noteCount: extracted.notes.length,
      channels,
    };
  });
  const parts = buildPlayableParts(tracks);

  return {
    fileName: file.name,
    format: parsed.header?.format,
    ticksPerBeat,
    tracks,
    parts,
  };
}
