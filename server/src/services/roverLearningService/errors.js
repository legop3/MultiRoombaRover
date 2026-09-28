// Keep actionable failures while removing credentials and user identifiers.
function redact(value) {
  if (value == null) return null;
  return String(value).slice(0, 12000)
    .replace(/\b(?:https?|rtsp|rtsps):\/\/[^\s'"<>]+/gi, '[redacted URL]')
    .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:password|token|secret|authorization|cookie|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\bcu_[a-z0-9]+/gi, '[redacted user]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\/(?:home|Users)\/[^/\s]+/g, '/[user]');
}
function errorDetails(error, operation) {
  return { atUnixMs: Date.now(), operation: redact(operation),
    name: redact(error?.name), message: redact(error?.message ?? error),
    code: redact(error?.code), syscall: redact(error?.syscall),
    path: redact(error?.path), stack: redact(error?.stack) };
}
module.exports = { redact, errorDetails };
