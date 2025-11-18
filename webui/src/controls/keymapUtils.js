const KEY_ALIASES = {
  '{': '[',
  '}': ']',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
  '|': '\\',
  '_': '-',
  '+': '=',
};

const BINDING_CODE_MAP = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
};

export function canonicalizeKeyInput(value) {
  if (typeof value !== 'string') return '';
  const lower = value.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

export function deriveCodeForKey(value) {
  const canonical = canonicalizeKeyInput(value);
  if (!canonical) return null;
  if (BINDING_CODE_MAP[canonical]) return BINDING_CODE_MAP[canonical];
  if (canonical.length === 1) {
    if (/[a-z]/.test(canonical)) return `Key${canonical.toUpperCase()}`;
    if (/[0-9]/.test(canonical)) return `Digit${canonical}`;
  }
  return null;
}

export function createKeyToken(value) {
  const canonical = canonicalizeKeyInput(value);
  return canonical ? `key:${canonical}` : null;
}

export function createCodeToken(value) {
  const code = deriveCodeForKey(value);
  return code ? `code:${code}` : null;
}

export function tokensForEvent(event) {
  const tokens = new Set();
  const keyToken = createKeyToken(event?.key ?? '');
  if (keyToken) tokens.add(keyToken);
  const codeToken = event?.code ? `code:${event.code}` : null;
  if (codeToken) tokens.add(codeToken);
  return Array.from(tokens);
}

export function normalizeKeymapEntries(keymap = {}) {
  return Object.fromEntries(
    Object.entries(keymap).map(([action, bindings]) => {
      const values = Array.isArray(bindings) ? bindings : [bindings];
      const normalized = new Set();
      values.forEach((value) => {
        const keyToken = createKeyToken(String(value));
        if (keyToken) normalized.add(keyToken);
        const codeToken = createCodeToken(String(value));
        if (codeToken) normalized.add(codeToken);
      });
      return [action, normalized];
    }),
  );
}

export function formatKeyLabel(value) {
  const canonical = canonicalizeKeyInput(value);
  if (!canonical) return '—';
  if (canonical === ' ') return 'Space';
  if (canonical === '\\') return 'Backslash';
  if (canonical === '`') return 'Backtick';
  if (canonical === '[') return '[ or {';
  if (canonical === ']') return '] or }';
  if (canonical === ';') return '; or :';
  if (canonical === "'") return "' or \"";
  if (canonical === ',') return ', or <';
  if (canonical === '.') return '. or >';
  if (canonical === '/') return '/ or ?';
  if (canonical === '-') return '- or _';
  if (canonical === '=') return '= or +';
  return canonical.length === 1 ? canonical.toUpperCase() : canonical;
}
