export const readLocalStorageJson = <T>(
  key: string,
  fallback: T,
  validate?: (value: unknown) => value is T
): T => {
  if (typeof localStorage === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;

  try {
    const parsed: unknown = JSON.parse(stored);
    if (validate && !validate(parsed)) {
      localStorage.removeItem(key);
      return fallback;
    }
    return parsed as T;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
};
