const SENSITIVE_KEY_PATTERN =
  /(?:api.?key|token|secret|credential|password|cookie|authorization|session.?id|target.?idc)/i;

export const LOCAL_SNAPSHOT_PREFIX = 'osone_local_snapshot_';
export const LOCAL_SNAPSHOT_ID_PATTERN =
  /^OSONE-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/;

export const isSensitiveSnapshotKey = (key: string): boolean => {
  return SENSITIVE_KEY_PATTERN.test(key);
};

const sanitizeNestedValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeNestedValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveSnapshotKey(key))
      .map(([key, nestedValue]) => [key, sanitizeNestedValue(nestedValue)])
  );
};

export const sanitizeSnapshotString = (value: string): string => {
  try {
    return JSON.stringify(sanitizeNestedValue(JSON.parse(value)));
  } catch {
    return value;
  }
};

export const sanitizeSnapshotPayload = (
  payload: Record<string, string>
): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) =>
        key.startsWith('osone_') &&
        !key.startsWith(LOCAL_SNAPSHOT_PREFIX) &&
        !isSensitiveSnapshotKey(key)
      )
      .map(([key, value]) => [key, sanitizeSnapshotString(String(value))])
  );
};

export const createLocalSnapshotId = (): string => {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0')
  ).join('').toUpperCase();
  return `OSONE-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
};
