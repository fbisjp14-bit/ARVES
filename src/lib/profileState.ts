import type { AIProfile, ChatSession, Message } from '../types';
import { normalizeExternalHttpUrl } from './externalUrl.js';

export const DEFAULT_AI_PROFILE: AIProfile = {
  name: 'OSONE',
  personality: 'Inteligência Artificial avançada, prestativa e focada em resultados.',
  writingStyle: 'Conciso, técnico mas amigável, direto ao ponto.'
};

export interface NormalizedHealthData {
  age: string;
  weight: string;
  height: string;
  gender: string;
  stylePreference: string;
  [key: string]: string | number;
}

export const DEFAULT_HEALTH_DATA: NormalizedHealthData = {
  age: '',
  weight: '',
  height: '',
  gender: 'masculino',
  stylePreference: 'casual'
};

export const createWelcomeHistory = (): Message[] => [{
  id: 'welcome',
  role: 'assistant',
  content: '### Bem-vindo ao OSONE G5! 🌐🛡️\n\nOlá! Sou o **OSONE**, seu assistente técnico inteligente. Estou online, otimizado e pronto para responder às suas dúvidas e comandos imediatamente.\n\nComo posso te ajudar hoje?'
}];

const safeText = (value: unknown, maxLength: number): string => {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
};

const safeImageUrl = (value: unknown): string | undefined => {
  const raw = safeText(value, 3_000_000);
  if (!raw) return undefined;
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(raw)) {
    return raw;
  }
  return normalizeExternalHttpUrl(raw) || undefined;
};

export const normalizeStoredMessages = (
  value: unknown,
  fallbackToWelcome = true
): Message[] => {
  if (!Array.isArray(value)) {
    return fallbackToWelcome ? createWelcomeHistory() : [];
  }

  const messages = value
    .slice(-300)
    .map((candidate, index): Message | null => {
      if (!candidate || typeof candidate !== 'object') return null;
      const source = candidate as Partial<Message>;
      if (source.role !== 'user' && source.role !== 'assistant') return null;
      const content = safeText(source.content, 250_000);
      const imageUrl = safeImageUrl(source.imageUrl);
      if (!content && !imageUrl) return null;
      return {
        id: safeText(source.id, 128) || `restored_${index}`,
        role: source.role,
        content,
        ...(imageUrl ? { imageUrl } : {})
      };
    })
    .filter((message): message is Message => Boolean(message));

  if (messages.length > 0 || !fallbackToWelcome) return messages;
  return createWelcomeHistory();
};

export const normalizeChatSessions = (value: unknown): ChatSession[] => {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const sessions: ChatSession[] = [];

  for (const candidate of value.slice(-100)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const source = candidate as Partial<ChatSession>;
    const id = safeText(source.id, 128);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    sessions.push({
      id,
      title: safeText(source.title, 200) || 'Conversa',
      createdAt:
        typeof source.createdAt === 'number' && Number.isFinite(source.createdAt)
          ? source.createdAt
          : Date.now(),
      messages: normalizeStoredMessages(source.messages, false)
    });
  }

  return sessions;
};

export const normalizeAiProfile = (value: unknown): AIProfile => {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AI_PROFILE };
  const source = value as Partial<AIProfile>;
  return {
    name: safeText(source.name, 100) || DEFAULT_AI_PROFILE.name,
    personality:
      safeText(source.personality, 8_000) || DEFAULT_AI_PROFILE.personality,
    writingStyle:
      safeText(source.writingStyle, 4_000) || DEFAULT_AI_PROFILE.writingStyle
  };
};

export const normalizeHealthData = (
  value: unknown
): NormalizedHealthData => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_HEALTH_DATA };
  }
  const normalized: NormalizedHealthData = { ...DEFAULT_HEALTH_DATA };
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) continue;
    if (typeof entry === 'string') normalized[key] = entry.slice(0, 2_000);
    if (typeof entry === 'number' && Number.isFinite(entry)) normalized[key] = entry;
  }
  return normalized;
};

export const normalizeIntimateAnswers = (
  value: unknown
): Record<number, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const answers: Record<number, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const id = Number(key);
    if (
      Number.isInteger(id) &&
      id >= 1 &&
      id <= 55 &&
      typeof entry === 'string'
    ) {
      answers[id] = entry.slice(0, 10_000);
    }
  }
  return answers;
};
