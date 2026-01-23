function parseCookieHeader(header = '') {
  if (!header || typeof header !== 'string') return {};
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, ...rest] = part.split('=');
      if (!key) return acc;
      acc[key] = rest.join('=');
      return acc;
    }, {});
}

module.exports = {
  parseCookieHeader,
};
