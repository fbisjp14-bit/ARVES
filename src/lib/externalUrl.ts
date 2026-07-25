export const normalizeExternalHttpUrl = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 4_096) return null;
  try {
    const target = new URL(raw);
    if (!['http:', 'https:'].includes(target.protocol)) return null;
    if (target.username || target.password) return null;
    return target.toString();
  } catch {
    return null;
  }
};

export const openExternalHttpUrl = (value: unknown): boolean => {
  const safeUrl = normalizeExternalHttpUrl(value);
  if (!safeUrl || typeof window === 'undefined') return false;
  const opened = window.open(safeUrl, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
  return true;
};
