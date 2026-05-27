export function getSessionSocials(state) {
  const socials = state?.session?.socials;
  return Array.isArray(socials) ? socials : [];
}

export function getSocialById(state, socialId) {
  const key = String(socialId || '').trim().toLowerCase();
  if (!key) return null;
  return (
    getSessionSocials(state).find((entry) => {
      const entryKey = String(entry?.id || entry?.label || '').trim().toLowerCase();
      return entryKey === key;
    }) || null
  );
}
