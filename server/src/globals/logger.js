const sinks = new Set();

function notifySinks(level, label, args) {
  if (!sinks.size) return;
  const entry = {
    level,
    label: label || null,
    args,
    message: args.map((value) => {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch (err) {
        return String(value);
      }
    }).join(' '),
    timestamp: new Date().toISOString(),
  };
  sinks.forEach((sink) => {
    try {
      sink(entry);
    } catch (err) {
      // avoid recursive logging
      console.error(entry.timestamp, '[ERROR]', '[logger]', 'Log sink failed', err);
    }
  });
}

function stamp(level, label, args) {
  const fields = [new Date().toISOString(), `[${level}]`];
  if (label) {
    fields.push(`[${label}]`);
  }
  notifySinks(level, label, args);
  return [...fields, ...args];
}

function baseLogger(label) {
  return {
    info: (...args) => console.log(...stamp('INFO', label, args)),
    warn: (...args) => console.warn(...stamp('WARN', label, args)),
    error: (...args) => console.error(...stamp('ERROR', label, args)),
  };
}

function registerSink(fn) {
  if (typeof fn !== 'function') return () => {};
  sinks.add(fn);
  return () => sinks.delete(fn);
}

module.exports = {
  ...baseLogger(),
  child: (label) => baseLogger(label),
  registerSink,
};
