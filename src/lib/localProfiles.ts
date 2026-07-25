import type { User } from '../types';

export const LOCAL_PROFILE_UID_PATTERN = /^local_[A-Za-z0-9_-]{8,64}$/;
const MAX_LOCAL_PROFILES = 50;

const cleanDisplayName = (value: unknown): string => {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 25)
    : '';
};

const profileEmail = (displayName: string): string => {
  const slug = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
  return `${slug || 'perfil'}@osone.local`;
};

export const normalizeLocalProfile = (value: unknown): User | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<User>;
  const uid = typeof candidate.uid === 'string' ? candidate.uid.trim() : '';
  const displayName = cleanDisplayName(candidate.displayName);
  if (
    candidate.isLocal !== true ||
    !LOCAL_PROFILE_UID_PATTERN.test(uid) ||
    !displayName
  ) {
    return null;
  }

  return {
    uid,
    displayName,
    email: profileEmail(displayName),
    isLocal: true
  };
};

export const normalizeLocalProfiles = (value: unknown): User[] => {
  if (!Array.isArray(value)) return [];
  const profiles: User[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  for (const candidate of value.slice(0, MAX_LOCAL_PROFILES * 2)) {
    const profile = normalizeLocalProfile(candidate);
    if (!profile) continue;
    const normalizedName = profile.displayName.toLocaleLowerCase('pt-BR');
    if (usedIds.has(profile.uid) || usedNames.has(normalizedName)) continue;
    usedIds.add(profile.uid);
    usedNames.add(normalizedName);
    profiles.push(profile);
    if (profiles.length >= MAX_LOCAL_PROFILES) break;
  }

  return profiles;
};
