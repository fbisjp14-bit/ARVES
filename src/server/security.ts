import dns from 'node:dns/promises';
import net from 'node:net';

export const CLIENT_ID_HEADER = 'x-osone-client-id';
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{20,96}$/;

export const normalizeClientId = (value: unknown): string => {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  return CLIENT_ID_PATTERN.test(normalized) ? normalized : '';
};

export const getClientId = (req: any): string => {
  return normalizeClientId(
    req?.headers?.[CLIENT_ID_HEADER] ??
    req?.query?.client_id ??
    req?.body?.clientId
  );
};

const isBlockedIpv4 = (address: string): boolean => {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && b >= 18 && b <= 19) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113)
  );
};

const isBlockedIpv6 = (address: string): boolean => {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  ) {
    return true;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isBlockedIpv4(mapped[1]) : false;
};

export const isBlockedIpAddress = (address: string): boolean => {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
};

export const isBlockedHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  return (
    !host ||
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    (net.isIP(host) !== 0 && isBlockedIpAddress(host))
  );
};

export const assertSafeExternalUrl = async (
  target: URL,
  options: { requireHttps?: boolean } = {}
): Promise<void> => {
  const allowedProtocols = options.requireHttps ? ['https:'] : ['http:', 'https:'];
  if (!allowedProtocols.includes(target.protocol)) {
    throw new Error('Protocolo não permitido.');
  }
  if (target.username || target.password) {
    throw new Error('URLs com credenciais embutidas não são permitidas.');
  }
  if (isBlockedHostname(target.hostname)) {
    throw new Error('Endereço privado ou interno não permitido.');
  }

  if (net.isIP(target.hostname) === 0) {
    const records = await dns.lookup(target.hostname, { all: true, verbatim: true });
    if (
      records.length === 0 ||
      records.some((record) => isBlockedIpAddress(record.address))
    ) {
      throw new Error('O domínio resolve para uma rede privada ou inválida.');
    }
  }
};

export const fetchExternalWithRedirectGuard = async (
  initialUrl: URL,
  init: RequestInit,
  options: { requireHttps?: boolean; maxRedirects?: number } = {}
): Promise<Response> => {
  const maxRedirects = options.maxRedirects ?? 4;
  let target = new URL(initialUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    await assertSafeExternalUrl(target, options);
    const response = await fetch(target, {
      ...init,
      redirect: 'manual'
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    target = new URL(location, target);
    if (redirectCount === maxRedirects) {
      throw new Error('A página excedeu o limite de redirecionamentos.');
    }
  }

  throw new Error('Redirecionamento inválido.');
};

export const readResponseTextLimited = async (
  response: Response,
  maxBytes: number
): Promise<string> => {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    throw new Error('A resposta remota excede o limite permitido.');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let consumed = 0;
  let result = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    consumed += value.byteLength;
    if (consumed > maxBytes) {
      await reader.cancel();
      throw new Error('A resposta remota excede o limite permitido.');
    }
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
};
