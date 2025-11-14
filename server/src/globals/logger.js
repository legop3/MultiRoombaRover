function stamp(level, label, args) {
  const fields = [new Date().toISOString(), `[${level}]`];
  if (label) {
    fields.push(`[${label}]`);
  }
  return [...fields, ...args];
}

function baseLogger(label) {
  return {
    info: (...args) => console.log(...stamp('INFO', label, args)),
    warn: (...args) => console.warn(...stamp('WARN', label, args)),
    error: (...args) => console.error(...stamp('ERROR', label, args)),
  };
}

module.exports = {
  ...baseLogger(),
  child: (label) => baseLogger(label),
};
