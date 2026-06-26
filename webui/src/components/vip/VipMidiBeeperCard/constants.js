// Midi Beeper constants
// Purpose: Keeps Roomba beeper timing, note limits, and UI defaults in one place.
// Scope: Shared by the Midi card, parser helpers, and playback scheduler.

export const ROOMBA_NOTE_MIN = 31;
export const ROOMBA_NOTE_MAX = 127;

// Roomba Open Interface song durations are expressed in 1/64 second ticks.
// Keeping this conversion explicit avoids confusing those device ticks with
// JavaScript milliseconds or MIDI ticks-per-beat.
export const ROOMBA_DURATION_TICK_MS = 1000 / 64;

// The Roomba drops a song command while a previous song is still playing. This
// guard accounts for browser timer jitter and websocket latency so the next
// note is less likely to arrive a few milliseconds too early.
export const BEEPER_READY_GUARD_MS = 24;

export const ROOMBA_SONG_MAX_NOTES = 16;

export const DEFAULT_LIVE_NOTE_TICKS = 8;
export const DEFAULT_FILE_NOTE_TICKS = 10;
export const DEFAULT_ARPEGGIO_NOTE_TICKS = 4;
export const DEFAULT_ARPEGGIO_NOTE_LIMIT = 6;
export const DEFAULT_ARRANGER_DENSITY = 3;

// OI accepts smaller duration bytes, but this app targets audible rover music,
// not theoretical byte validity. Values below this have not been useful on the
// physical beeper, so arrangement controls clamp to the practical floor.
export const PRACTICAL_MIN_NOTE_TICKS = 4;

// Long held MIDI notes sound bad on the Roomba and block following notes. This
// cap keeps playback responsive while still preserving rough note lengths.
export const MAX_FILE_NOTE_TICKS = 48;

// Small MIDI timing gaps are usually expressive overlap/quantization noise, not
// meaningful silence for a single-note beeper. Larger gaps should split chunks
// so file playback still breathes between phrases.
export const FILE_CHUNK_GAP_THRESHOLD_MS = 45;

export const PLAYBACK_MODES = [
  { id: 'arranged', label: 'Arranged' },
  { id: 'mono', label: 'Lead line' },
  { id: 'arpeggio', label: 'Arpeggio' },
];

export const LIVE_DEVICE_EMPTY_VALUE = '';
