function stamp(level, args) {
  return [new Date().toISOString(), `[${level}]`, ...args];
}

module.exports = {
  info: (...args) => console.log(...stamp('INFO', args)),
  warn: (...args) => console.warn(...stamp('WARN', args)),
  error: (...args) => console.error(...stamp('ERROR', args)),
};
