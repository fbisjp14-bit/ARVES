export const redactSecrets = (
  value: unknown,
  explicitSecrets: unknown[] = [],
  maxLength = 700
): string => {
  let sanitized = String(value || '')
    .replace(/\bAIza[A-Za-z0-9_-]+\b/g, '[CHAVE_REMOVIDA]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[CHAVE_REMOVIDA]')
    .replace(/\btvly-[A-Za-z0-9_-]+\b/g, '[CHAVE_REMOVIDA]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [CHAVE_REMOVIDA]')
    .replace(/([?&](?:key|apiKey|api_key|token)=)[^&\s]+/gi, '$1[CHAVE_REMOVIDA]');

  for (const secret of explicitSecrets) {
    const normalized = typeof secret === 'string' ? secret : '';
    if (normalized.length >= 6) {
      sanitized = sanitized.split(normalized).join('[CHAVE_REMOVIDA]');
    }
  }

  return sanitized.slice(0, maxLength);
};
