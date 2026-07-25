const CLIENT_ID_KEY = 'osone_client_id_v1';
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{20,96}$/;

const createClientId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}_${random}_${Math.random().toString(36).slice(2)}`;
};

export const getOrCreateClientId = (): string => {
  try {
    const existing = sessionStorage.getItem(CLIENT_ID_KEY) || '';
    if (CLIENT_ID_PATTERN.test(existing)) return existing;
    const created = createClientId();
    sessionStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return createClientId();
  }
};

export const withOsoneClientId = (init: RequestInit = {}): RequestInit => {
  const headers = new Headers(init.headers);
  headers.set('X-OSONE-Client-ID', getOrCreateClientId());
  return { ...init, headers };
};
