registerModule('helpers/formatters', (require, exports) => {
  function formatHex(base64) {
    if (!base64) return '';
    const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return Array.from(buffer)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
  }

  exports.formatHex = formatHex;
});
