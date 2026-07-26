import express from 'express';
import {
  normalizeGeminiApiKey,
  verifyGeminiApiKey
} from '../src/lib/geminiApi.js';
import { createOpenAIRouter } from '../src/server/openaiRouter.js';
import {
  runImageWithFallback,
  runTextWithFallback
} from '../src/server/providerOrchestrator.js';
import ttsHttpHandler from '../src/server/ttsHttp.js';
import {
  fetchExternalWithRedirectGuard,
  getClientId,
  readResponseTextLimited
} from '../src/server/security.js';
import { redactSecrets } from '../src/lib/redaction.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

const activeRequests = new Map<string, { active: number; lastSeen: number }>();
const requestRates = new Map<string, {
  count: number;
  windowStarted: number;
  lastSeen: number;
}>();
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_CLIENT_WINDOW = 240;
const MAX_REQUESTS_PER_IP_WINDOW = 1_000;

const consumeRequestRate = (
  key: string,
  limit: number,
  now: number
): boolean => {
  const current = requestRates.get(key);
  const slot =
    !current || now - current.windowStarted >= RATE_WINDOW_MS
      ? { count: 0, windowStarted: now, lastSeen: now }
      : current;
  slot.count += 1;
  slot.lastSeen = now;
  requestRates.set(key, slot);

  if (requestRates.size > 4_000) {
    for (const [rateKey, rateSlot] of requestRates) {
      if (now - rateSlot.lastSeen > RATE_WINDOW_MS * 2) {
        requestRates.delete(rateKey);
      }
    }
    if (requestRates.size > 4_000) {
      const oldest = [...requestRates.entries()]
        .sort((left, right) => left[1].lastSeen - right[1].lastSeen)
        .slice(0, requestRates.size - 4_000);
      for (const [rateKey] of oldest) requestRates.delete(rateKey);
    }
  }
  return slot.count <= limit;
};

app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && req.path === '/health') return next();
  const now = Date.now();
  const clientId = getClientId(req);
  const ipAddress = req.ip || 'anonymous';
  if (
    (clientId &&
      !consumeRequestRate(
        `client:${clientId}`,
        MAX_REQUESTS_PER_CLIENT_WINDOW,
        now
      )) ||
    !consumeRequestRate(`ip:${ipAddress}`, MAX_REQUESTS_PER_IP_WINDOW, now)
  ) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({
      error: 'Limite temporário de solicitações atingido. Aguarde um minuto.'
    });
  }

  const identity = clientId || ipAddress;
  const slot = activeRequests.get(identity) || { active: 0, lastSeen: now };
  if (slot.active >= 8) {
    return res.status(429).json({
      error: 'Muitas operações simultâneas nesta sessão. Aguarde uma delas terminar.'
    });
  }
  slot.active += 1;
  slot.lastSeen = now;
  activeRequests.set(identity, slot);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    slot.active = Math.max(0, slot.active - 1);
    slot.lastSeen = Date.now();
    if (slot.active === 0 && activeRequests.get(identity) === slot) {
      activeRequests.delete(identity);
    }
  };
  res.once('finish', release);
  res.once('close', release);
  next();
});
app.use('/api/openai', createOpenAIRouter());

const getGeminiKey = (body: any): string => {
  return normalizeGeminiApiKey(
    body?.clientApiKey ||
    body?.geminiApiKey ||
    process.env.GEMINI_API_KEY
  );
};

const sendError = (res: express.Response, error: any): express.Response => {
  const status =
    typeof error?.status === 'number' && error.status >= 400
      ? error.status
      : 500;
  return res.status(status).json({
    error: redactSecrets(
      error?.message || 'Erro interno ao processar a solicitação.'
    )
  });
};

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'osone-vercel-api',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/gemini/verify', async (req, res) => {
  const apiKey = normalizeGeminiApiKey(req.body?.geminiApiKey);
  if (!apiKey) {
    return res.status(400).json({
      success: false,
      message: 'A chave API do Gemini é obrigatória para verificação.'
    });
  }

  const result = await verifyGeminiApiKey(apiKey);
  return res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/gemini/generateContent', async (req, res) => {
  try {
    return res.json(await runTextWithFallback(req.body || {}));
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const response = await runTextWithFallback({
      ...req.body,
      contents: req.body?.prompt || '',
      config: {
        ...(req.body?.config || {}),
        ...(req.body?.systemInstruction
          ? { systemInstruction: req.body.systemInstruction }
          : {}),
        ...(req.body?.responseMimeType
          ? { responseMimeType: req.body.responseMimeType }
          : {})
      }
    });
    return res.json(response);
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/chat-intel', async (req, res) => {
  try {
    const response = await runTextWithFallback({
      ...req.body,
      contents: req.body?.historyContents || req.body?.contents,
      config: {
        ...(req.body?.config || {}),
        maxOutputTokens: 250,
        temperature: 0.7,
        systemInstruction: req.body?.systemInstruction
      }
    });
    return res.json(response);
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/chat-intel-stream', async (req, res) => {
  try {
    const response = await runTextWithFallback({
      ...req.body,
      contents: req.body?.historyContents || req.body?.contents,
      config: {
        ...(req.body?.config || {}),
        maxOutputTokens: 250,
        temperature: 0.7,
        systemInstruction: req.body?.systemInstruction
      }
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.write(`data: ${JSON.stringify({
      text: response?.text || '',
      provider: response?.provider,
      fallbackUsed: response?.fallbackUsed
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  } catch (error: any) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.write(`data: ${JSON.stringify({
      error: redactSecrets(error?.message || 'Falha na geração.')
    })}\n\n`);
    return res.end();
  }
});

app.post('/api/gemini/generateImages', async (req, res) => {
  try {
    return res.json(await runImageWithFallback(req.body || {}));
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/search/custom', async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    const key = normalizeGeminiApiKey(req.body?.key || process.env.GOOGLE_API_KEY);
    const cx = String(req.body?.cx || process.env.GOOGLE_CSE_ID || '').trim();

    if (!query) return res.status(400).json({ error: 'O termo de pesquisa é obrigatório.' });
    if (!key || !cx) {
      return res.status(400).json({
        error: 'Google Custom Search não configurado. Informe a chave e o CX nas Chaves Extras.'
      });
    }

    const target = new URL('https://www.googleapis.com/customsearch/v1');
    target.searchParams.set('key', key);
    target.searchParams.set('cx', cx);
    target.searchParams.set('q', query);

    const response = await fetch(target);
    if (!response.ok) {
      return res.status(response.status).json({
        error: `A Pesquisa Google recusou a solicitação (HTTP ${response.status}).`
      });
    }

    return res.json(await response.json());
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/search/tavily', async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    const apiKey = normalizeGeminiApiKey(
      req.body?.apiKey || process.env.TAVILY_API_KEY
    );

    if (!query) return res.status(400).json({ error: 'O termo de pesquisa é obrigatório.' });
    if (!apiKey) {
      return res.status(400).json({
        error: 'API Key do Tavily não configurada nas Chaves Extras.'
      });
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 5
      })
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `A Tavily recusou a pesquisa (HTTP ${response.status}).`
      });
    }

    return res.json(await response.json());
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/scrape', async (req, res) => {
  try {
    const target = new URL(String(req.body?.url || ''));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const response = await fetchExternalWithRedirectGuard(
      target,
      {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OSONE/3.0; +https://vercel.app)',
          Accept: 'text/html, text/plain;q=0.9'
        }
      },
      { maxRedirects: 4 }
    ).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      return res.status(400).json({
        error: `Falha ao acessar a página (HTTP ${response.status}).`
      });
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    if (
      contentType &&
      !contentType.includes('text/html') &&
      !contentType.includes('text/plain')
    ) {
      return res.status(415).json({
        error: 'A URL não retornou uma página de texto compatível.'
      });
    }

    const html = await readResponseTextLimited(response, 1_000_000);
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12_000);

    return res.json({ text });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'A página demorou demais para responder.' });
    }
    return res.status(400).json({
      error: error?.message || 'URL inválida ou página inacessível.'
    });
  }
});

app.post('/api/lens/query', async (req, res) => {
  try {
    const image = String(req.body?.image || '');
    if (!image) return res.status(400).json({ error: 'A imagem é obrigatória.' });

    const match = image.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match?.[1] || 'image/jpeg';
    const base64Data = match?.[2] || image;
    const response = await runTextWithFallback({
      ...req.body,
      model: req.body?.model || 'gemini-3.6-flash',
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          {
            text: 'Identifique detalhadamente a imagem. Responda em JSON com name, category, confidence, description, tags, details e suggestions.'
          }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        ...(req.body?.internetSearch ? { tools: [{ googleSearch: {} }] } : {})
      }
    });

    const rawText = String(response?.text || '')
      .split('### Fontes consultadas')[0]
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const result = JSON.parse(rawText || '{}');
    result.citations = Array.isArray(response?.citations)
      ? response.citations
      : [];
    result.provider = response?.provider;
    result.fallbackUsed = Boolean(response?.fallbackUsed);

    return res.json(result);
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/elevenlabs/verify', async (req, res) => {
  try {
    const apiKey = normalizeGeminiApiKey(req.body?.elevenLabsApiKey);
    const voiceId = String(req.body?.elevenLabsVoiceId || '').trim();
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'A chave API da ElevenLabs é obrigatória.'
      });
    }

    const userResponse = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey }
    });
    if (!userResponse.ok) {
      return res.status(userResponse.status === 401 ? 401 : 400).json({
        success: false,
        message: 'Chave da ElevenLabs inválida, expirada ou sem permissão.'
      });
    }

    if (voiceId) {
      const voiceResponse = await fetch(
        `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`,
        { headers: { 'xi-api-key': apiKey } }
      );
      if (!voiceResponse.ok) {
        return res.status(400).json({
          success: false,
          message: 'A chave é válida, mas o Voice ID não está acessível.'
        });
      }
      const voice = await voiceResponse.json();
      return res.json({
        success: true,
        message: `Chave válida. Voz encontrada: ${voice?.name || voiceId}.`
      });
    }

    return res.json({
      success: true,
      message: 'Conexão com a ElevenLabs validada com sucesso.'
    });
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/tts', ttsHttpHandler as any);

type WhatsAppConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTED'
  | 'CONNECTING'
  | 'WAITING_QR';

interface WhatsAppConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  enabled: boolean;
  geminiApiKey: string;
}

interface WhatsAppLog {
  id: string;
  timestamp: number;
  type: 'received' | 'sent' | 'error' | 'info';
  sender: string;
  message: string;
  response?: string;
}

interface TikTokState {
  status: 'connected' | 'disconnected' | 'connecting';
  username: string;
  isAutoRespondActive: boolean;
  viewerCount: number;
  likeCount: number;
  sessionId: string;
  targetIdc: string;
  logs: Array<{
    id: string;
    timestamp: number;
    type: 'chat' | 'gift' | 'like' | 'info' | 'error';
    user: string;
    message: string;
  }>;
  lastSimulationAt: number;
}

interface ClientRuntimeState {
  lastSeen: number;
  whatsappConfig: WhatsAppConfig;
  whatsappLogs: WhatsAppLog[];
  whatsappVirtualState: WhatsAppConnectionState;
  whatsappLocalStatus: 'desconectado' | 'erro';
  tiktok: TikTokState;
}

const clientStates = new Map<string, ClientRuntimeState>();
const CLIENT_STATE_TTL_MS = 60 * 60 * 1000;
const MAX_CLIENT_STATES = 2_000;

const createClientRuntimeState = (): ClientRuntimeState => ({
  lastSeen: Date.now(),
  whatsappConfig: {
    apiUrl: '',
    apiKey: '',
    instanceName: 'osone_assistant',
    enabled: false,
    geminiApiKey: ''
  },
  whatsappLogs: [{
    id: `init_${Date.now()}`,
    timestamp: Date.now(),
    type: 'info',
    sender: 'Sistema',
    message: 'Sessão WhatsApp isolada e pronta para configuração.'
  }],
  whatsappVirtualState: 'DISCONNECTED',
  whatsappLocalStatus: 'desconectado',
  tiktok: {
    status: 'disconnected',
    username: '',
    isAutoRespondActive: false,
    viewerCount: 0,
    likeCount: 0,
    sessionId: '',
    targetIdc: '',
    logs: [],
    lastSimulationAt: 0
  }
});

const cleanupClientStates = (): void => {
  const now = Date.now();
  for (const [clientId, state] of clientStates) {
    if (now - state.lastSeen > CLIENT_STATE_TTL_MS) {
      clientStates.delete(clientId);
    }
  }
  if (clientStates.size <= MAX_CLIENT_STATES) return;
  const oldest = [...clientStates.entries()]
    .sort((left, right) => left[1].lastSeen - right[1].lastSeen)
    .slice(0, clientStates.size - MAX_CLIENT_STATES);
  for (const [clientId] of oldest) clientStates.delete(clientId);
};

const requireClientState = (
  req: express.Request,
  res: express.Response
): ClientRuntimeState | null => {
  const clientId = getClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: 'Identificador de sessão ausente. Atualize a página e tente novamente.'
    });
    return null;
  }
  cleanupClientStates();
  const existing = clientStates.get(clientId) || createClientRuntimeState();
  existing.lastSeen = Date.now();
  clientStates.set(clientId, existing);
  return existing;
};

const addWhatsAppLog = (
  state: ClientRuntimeState,
  log: Omit<WhatsAppLog, 'id' | 'timestamp'>
): void => {
  state.whatsappLogs.unshift({
    ...log,
    sender: String(log.sender || 'Sistema').slice(0, 100),
    message: redactSecrets(log.message, [], 4_000),
    ...(log.response
      ? { response: redactSecrets(log.response, [], 4_000) }
      : {}),
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: Date.now()
  });
  state.whatsappLogs = state.whatsappLogs.slice(0, 100);
};

const validateInstanceName = (value: unknown): string => {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(normalized)) {
    throw new Error('Nome de instância inválido. Use apenas letras, números, _ e -.');
  }
  return normalized;
};

const requestWhatsAppConfig = (
  value: unknown,
  fallback: WhatsAppConfig
): WhatsAppConfig => {
  if (!value || typeof value !== 'object') return fallback;
  const candidate = value as Record<string, unknown>;
  const apiUrl = String(candidate.apiUrl || '').trim().replace(/\/+$/, '');
  if (!apiUrl) throw new Error('URL da Evolution API não configurada.');
  const parsed = new URL(apiUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('A URL da Evolution API precisa começar com https://.');
  }
  return {
    apiUrl,
    apiKey: String(candidate.apiKey || '').trim().slice(0, 2_000),
    instanceName: validateInstanceName(candidate.instanceName),
    enabled: Boolean(candidate.enabled),
    geminiApiKey: normalizeGeminiApiKey(candidate.geminiApiKey).slice(0, 2_000)
  };
};

const publicWhatsAppConfig = (config: WhatsAppConfig) => ({
  apiUrl: config.apiUrl,
  instanceName: config.instanceName,
  enabled: config.enabled
});

const buildEvolutionTarget = (
  config: WhatsAppConfig,
  endpointValue: unknown
): { base: URL; target: URL } => {
  if (!config.apiUrl) throw new Error('URL da Evolution API não configurada.');
  const base = new URL(config.apiUrl);
  if (base.protocol !== 'https:') {
    throw new Error('A Evolution API deve usar HTTPS no ambiente publicado.');
  }
  const endpoint = String(endpointValue || '').trim();
  if (
    !endpoint.startsWith('/') ||
    endpoint.includes('\\') ||
    endpoint.split('/').includes('..') ||
    /^\/\//.test(endpoint)
  ) {
    throw new Error('Endpoint da Evolution API inválido.');
  }
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
  const target = new URL(endpoint.replace(/^\/+/, ''), base);
  if (target.origin !== base.origin) {
    throw new Error('O endpoint deve permanecer no mesmo servidor Evolution.');
  }
  return { base, target };
};

const callEvolution = async (
  config: WhatsAppConfig,
  endpoint: unknown,
  methodValue: unknown,
  body: unknown,
  extraHeaders: unknown
): Promise<Response> => {
  const { target } = buildEvolutionTarget(config, endpoint);
  const method = String(methodValue || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error('Método HTTP não permitido.');
  }

  const incomingHeaders =
    extraHeaders && typeof extraHeaders === 'object'
      ? extraHeaders as Record<string, unknown>
      : {};
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json'
  });
  for (const [name, value] of Object.entries(incomingHeaders)) {
    const normalizedName = name.toLowerCase();
    if (
      ['apikey', 'authorization', 'accept', 'content-type'].includes(normalizedName) &&
      typeof value === 'string' &&
      value.length <= 2_000
    ) {
      headers.set(name, value);
    }
  }
  if (config.apiKey && !headers.has('apikey')) {
    headers.set('apikey', config.apiKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);
  try {
    return await fetchExternalWithRedirectGuard(
      target,
      {
        method,
        headers,
        signal: controller.signal,
        ...(method !== 'GET' && body !== undefined
          ? { body: JSON.stringify(body) }
          : {})
      },
      { requireHttps: true, maxRedirects: 2 }
    );
  } finally {
    clearTimeout(timeout);
  }
};

app.get('/api/whatsapp/config', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  return res.json(publicWhatsAppConfig(state.whatsappConfig));
});

app.post('/api/whatsapp/config', async (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  try {
    const next: WhatsAppConfig = {
      apiUrl:
        req.body?.apiUrl === undefined
          ? state.whatsappConfig.apiUrl
          : String(req.body.apiUrl || '').trim().replace(/\/+$/, ''),
      apiKey:
        req.body?.apiKey === undefined
          ? state.whatsappConfig.apiKey
          : String(req.body.apiKey || '').trim().slice(0, 2_000),
      instanceName:
        req.body?.instanceName === undefined
          ? state.whatsappConfig.instanceName
          : validateInstanceName(req.body.instanceName),
      enabled:
        req.body?.enabled === undefined
          ? state.whatsappConfig.enabled
          : Boolean(req.body.enabled),
      geminiApiKey:
        req.body?.geminiApiKey === undefined
          ? state.whatsappConfig.geminiApiKey
          : normalizeGeminiApiKey(req.body.geminiApiKey).slice(0, 2_000)
    };
    if (next.apiUrl) {
      const parsed = new URL(next.apiUrl);
      if (parsed.protocol !== 'https:') {
        return res.status(400).json({
          error: 'A URL da Evolution API precisa começar com https://.'
        });
      }
    }
    // Functions da Vercel podem ser reutilizadas entre chamadas. Preserve apenas
    // dados não sensíveis; cada operação recebe as credenciais diretamente do
    // navegador da própria sessão.
    state.whatsappConfig = {
      ...next,
      apiKey: '',
      geminiApiKey: ''
    };
    addWhatsAppLog(state, {
      type: 'info',
      sender: 'Sistema',
      message: `Configuração atualizada para a instância ${next.instanceName}.`
    });
    return res.json({
      status: 'success',
      config: publicWhatsAppConfig(state.whatsappConfig),
      apiKeyConfigured: Boolean(next.apiKey),
      geminiApiKeyConfigured: Boolean(next.geminiApiKey)
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Configuração inválida.' });
  }
});

app.get('/api/whatsapp/logs', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  return res.json(state.whatsappLogs);
});

app.post('/api/whatsapp/clear-logs', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  state.whatsappLogs = [];
  return res.json({ status: 'success' });
});

app.get('/api/whatsapp/virtual-state', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  return res.json({ state: state.whatsappVirtualState });
});

app.post('/api/whatsapp/virtual-state', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  const next = String(req.body?.state || '').toUpperCase();
  if (!['DISCONNECTED', 'CONNECTED', 'CONNECTING', 'WAITING_QR'].includes(next)) {
    return res.status(400).json({ error: 'Estado virtual inválido.' });
  }
  state.whatsappVirtualState = next as WhatsAppConnectionState;
  return res.json({ state: state.whatsappVirtualState });
});

app.post('/api/whatsapp/proxy', async (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  try {
    const runtimeConfig = requestWhatsAppConfig(
      req.body?.config,
      state.whatsappConfig
    );
    const response = await callEvolution(
      runtimeConfig,
      req.body?.endpoint,
      req.body?.method,
      req.body?.body,
      req.body?.headers
    );
    const text = await readResponseTextLimited(response, 2_000_000);
    const contentType = response.headers.get('content-type') || '';
    res.status(response.status);
    if (contentType.includes('application/json')) {
      try {
        return res.json(text ? JSON.parse(text) : {});
      } catch {
        return res.json({ raw: text });
      }
    }
    res.type('text/plain');
    return res.send(text);
  } catch (error: any) {
    const timeout = error?.name === 'AbortError';
    return res.status(timeout ? 504 : 400).json({
      error: error?.message || 'Não foi possível alcançar a Evolution API.'
    });
  }
});

app.post('/api/whatsapp/simulate-incoming', async (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  const senderName = String(req.body?.senderName || 'Contato').slice(0, 100);
  const text = String(req.body?.text || '').trim().slice(0, 4_000);
  if (!text) return res.status(400).json({ error: 'A mensagem é obrigatória.' });
  addWhatsAppLog(state, {
    type: 'received',
    sender: senderName,
    message: text
  });
  let runtimeConfig = state.whatsappConfig;
  if (req.body?.config && typeof req.body.config === 'object') {
    try {
      runtimeConfig = {
        ...runtimeConfig,
        ...req.body.config,
        instanceName: validateInstanceName(
          req.body.config.instanceName || runtimeConfig.instanceName
        ),
        apiKey: String(req.body.config.apiKey || '').slice(0, 2_000),
        geminiApiKey: normalizeGeminiApiKey(req.body.config.geminiApiKey).slice(0, 2_000),
        enabled: Boolean(req.body.config.enabled)
      };
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Configuração inválida.' });
    }
  }
  if (!runtimeConfig.enabled) {
    return res.status(409).json({ error: 'O chatbot está pausado.' });
  }

  const geminiApiKey = normalizeGeminiApiKey(
    req.body?.clientApiKey ||
    req.body?.geminiApiKey ||
    runtimeConfig.geminiApiKey ||
    process.env.GEMINI_API_KEY
  );
  const openaiApiKey = String(
    req.body?.openaiApiKey ||
    process.env.OPENAI_API_KEY ||
    ''
  ).trim();
  if (!geminiApiKey && !openaiApiKey) {
    addWhatsAppLog(state, {
      type: 'error',
      sender: 'Sistema',
      message: 'Nenhuma chave de IA foi configurada para o simulador.'
    });
    return res.status(400).json({
      error: 'Configure uma chave Gemini ou OpenAI para o simulador.'
    });
  }

  try {
    const generated = await runTextWithFallback({
      ...req.body,
      clientApiKey: geminiApiKey,
      openaiApiKey,
      openaiModel: 'gpt-5.6-sol',
      contents:
        `Responda como atendente de WhatsApp, em português, de forma útil e breve.\n\n${senderName}: ${text}`,
      config: { maxOutputTokens: 350, temperature: 0.6 }
    });
    const reply = String(generated?.text || '').trim();
    addWhatsAppLog(state, {
      type: 'sent',
      sender: 'OSONE',
      message: reply,
      response: reply
    });
    return res.json({
      status: 'success',
      reply,
      provider: generated?.provider,
      fallbackUsed: Boolean(generated?.fallbackUsed)
    });
  } catch (error: any) {
    addWhatsAppLog(state, {
      type: 'error',
      sender: 'Sistema',
      message: error?.message || 'Falha ao gerar resposta.'
    });
    return sendError(res, error);
  }
});

app.post('/api/whatsapp/webhook', (_req, res) => {
  return res.status(501).json({
    error: 'Webhook contínuo desativado nesta Function stateless. Use um worker persistente autenticado por instância.'
  });
});

app.get('/api/whatsapp/status', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  return res.json({
    status: state.whatsappLocalStatus,
    error: 'O conector Puppeteer local foi removido por segurança. Use Evolution API.'
  });
});

app.get('/api/whatsapp/qr', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  return res.status(410).json({
    error: 'QR local indisponível na Vercel. Gere o QR pela Evolution API.'
  });
});

app.post('/api/whatsapp/connect', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  state.whatsappLocalStatus = 'erro';
  return res.status(410).json({
    status: 'erro',
    error: 'O conector whatsapp-web.js não é compatível com Vercel. Use Evolution API.'
  });
});

app.post('/api/whatsapp/disconnect', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  state.whatsappLocalStatus = 'desconectado';
  return res.json({ status: 'desconectado' });
});

app.get('/api/tiktok/state', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  const live = state.tiktok;
  if (live.status === 'connected' && Date.now() - live.lastSimulationAt > 8_000) {
    live.lastSimulationAt = Date.now();
    live.viewerCount = Math.max(1, live.viewerCount + Math.floor(Math.random() * 5) - 2);
    live.likeCount += Math.floor(Math.random() * 12);
    live.logs.unshift({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      type: 'chat',
      user: `viewer_${Math.floor(Math.random() * 900 + 100)}`,
      message: 'Mensagem simulada para teste isolado da interface.'
    });
    live.logs = live.logs.slice(0, 100);
  }
  return res.json(live);
});

app.post('/api/tiktok/connect', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  if (req.body?.simulate !== true) {
    return res.status(501).json({
      error: 'A conexão TikTok real não é segura em uma Function da Vercel. Use o simulador ou um worker dedicado.'
    });
  }
  const username = String(req.body?.username || '').trim().replace(/^@/, '').slice(0, 40);
  if (!/^[A-Za-z0-9._]{1,40}$/.test(username)) {
    return res.status(400).json({ error: 'Informe um usuário TikTok válido.' });
  }
  state.tiktok = {
    status: 'connected',
    username,
    isAutoRespondActive: false,
    viewerCount: 42,
    likeCount: 120,
    sessionId: '',
    targetIdc: '',
    lastSimulationAt: Date.now(),
    logs: [{
      id: `${Date.now()}_connected`,
      timestamp: Date.now(),
      type: 'info',
      user: 'Sistema',
      message: `Simulação isolada iniciada para @${username}.`
    }]
  };
  return res.json({ status: 'success', message: 'Simulador TikTok conectado.' });
});

app.post('/api/tiktok/disconnect', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  state.tiktok.status = 'disconnected';
  state.tiktok.viewerCount = 0;
  return res.json({ status: 'success', message: 'Sessão TikTok desconectada.' });
});

app.post('/api/tiktok/config', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  if (req.body?.isAutoRespondActive !== undefined) {
    state.tiktok.isAutoRespondActive = Boolean(req.body.isAutoRespondActive);
  }
  return res.json({ status: 'success', state: state.tiktok });
});

app.post('/api/tiktok/clear-logs', (req, res) => {
  const state = requireClientState(req, res);
  if (!state) return;
  state.tiktok.logs = [];
  return res.json({ status: 'success' });
});

app.use('/api', (_req, res) => {
  res.status(404).json({
    error: 'Esta função não está disponível no ambiente serverless da Vercel.'
  });
});

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'O arquivo ou conteúdo enviado excede o limite de 4 MB da função.'
    });
  }
  if (error instanceof SyntaxError) {
    return res.status(400).json({ error: 'JSON inválido na solicitação.' });
  }
  return res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
});

export default app;
