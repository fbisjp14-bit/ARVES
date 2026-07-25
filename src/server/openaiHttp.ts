import {
  buildOpenAIResponseRequest,
  normalizeOpenAIKey,
  openAIResponseToGemini
} from '../lib/openaiCompatibility.js';
import { redactSecrets } from '../lib/redaction.js';

const OPENAI_API_ROOT = 'https://api.openai.com/v1';
const REQUEST_TIMEOUT_MS = 55_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type OpenAIHttpAction =
  | 'verify'
  | 'generate-compatible'
  | 'chat-intel-stream'
  | 'images';

type NodeLikeRequest = {
  method?: string;
  body?: unknown;
  on?: (event: string, listener: (chunk?: unknown) => void) => void;
};

type NodeLikeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Uint8Array) => void;
  write?: (body: string) => void;
};

const safeOpenAIError = (
  value: unknown,
  secrets: string[] = []
): string =>
  redactSecrets(
    value || 'A OpenAI não respondeu à solicitação.',
    secrets
  ) || 'A OpenAI não respondeu à solicitação.';

const sendJson = (
  res: NodeLikeResponse,
  status: number,
  body: unknown
): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
};

const parseBodyValue = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object' && !Buffer.isBuffer(value)) {
    return value as Record<string, any>;
  }
  const text = Buffer.isBuffer(value)
    ? value.toString('utf8')
    : String(value);
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Corpo JSON inválido.');
  }
  return parsed;
};

const readJsonBody = async (
  req: NodeLikeRequest
): Promise<Record<string, any>> => {
  if (req.body !== undefined) return parseBodyValue(req.body);
  if (typeof req.on !== 'function') return {};

  return await new Promise<Record<string, any>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on?.('data', (chunk) => {
      const buffer = Buffer.from(chunk as any);
      total += buffer.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Corpo da solicitação excede 4 MB.'));
        return;
      }
      chunks.push(buffer);
    });
    req.on?.('end', () => {
      try {
        resolve(parseBodyValue(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    });
    req.on?.('error', (error) => reject(error));
  });
};

const getOpenAIKey = (body: Record<string, any>): string =>
  normalizeOpenAIKey(
    body.openaiApiKey ||
    body.clientOpenAIApiKey ||
    process.env.OPENAI_API_KEY
  );

const openAIFetch = async (
  path: string,
  apiKey: string,
  init: RequestInit = {}
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');

  try {
    return await fetch(`${OPENAI_API_ROOT}${path}`, {
      ...init,
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const readOpenAIError = async (
  response: Response,
  apiKey: string
): Promise<string> => {
  try {
    const body = await response.clone().json();
    return safeOpenAIError(
      body?.error?.message ||
      body?.message ||
      `HTTP ${response.status}`,
      [apiKey]
    );
  } catch {
    return `HTTP ${response.status}`;
  }
};

const aspectRatioToSize = (aspectRatio: unknown): string => {
  switch (aspectRatio) {
    case '16:9':
    case '4:3':
    case '3:2':
      return '1536x1024';
    case '9:16':
    case '3:4':
    case '2:3':
      return '1024x1536';
    default:
      return '1024x1024';
  }
};

const handleOpenAIAction = async (
  action: OpenAIHttpAction,
  body: Record<string, any>,
  res: NodeLikeResponse
): Promise<void> => {
  const apiKey = getOpenAIKey(body);
  if (!apiKey) {
    sendJson(res, 400, {
      success: false,
      error: 'Chave API da OpenAI não definida. Insira sua chave nos Ajustes ou configure OPENAI_API_KEY na Vercel.'
    });
    return;
  }

  if (action === 'verify') {
    const response = await openAIFetch('/models', apiKey, { method: 'GET' });
    if (!response.ok) {
      sendJson(res, response.status, {
        success: false,
        message: await readOpenAIError(response, apiKey)
      });
      return;
    }
    sendJson(res, 200, {
      success: true,
      message: 'Conexão com a OpenAI validada. Chat, pesquisa na web e imagens estão disponíveis.'
    });
    return;
  }

  if (action === 'images') {
    const prompt = String(body.prompt || '').trim();
    if (!prompt) {
      sendJson(res, 400, {
        error: 'Descreva a imagem que deseja gerar.'
      });
      return;
    }

    const response = await openAIFetch('/images/generations', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: prompt.slice(0, 32_000),
        n: 1,
        quality: body.openaiImageQuality === 'medium' ? 'medium' : 'high',
        size: aspectRatioToSize(body.config?.aspectRatio),
        output_format: 'png',
        moderation: 'auto'
      })
    });
    if (!response.ok) {
      sendJson(res, response.status, {
        error: await readOpenAIError(response, apiKey)
      });
      return;
    }

    const imageResponse = await response.json();
    const imageBytes = imageResponse?.data?.[0]?.b64_json;
    if (!imageBytes) {
      sendJson(res, 502, {
        error: 'A OpenAI concluiu a solicitação, mas não retornou os dados da imagem.'
      });
      return;
    }

    sendJson(res, 200, {
      provider: 'openai',
      model: 'gpt-image-2',
      outputMimeType: 'image/png',
      generatedImages: [{
        image: { imageBytes }
      }]
    });
    return;
  }

  const response = await openAIFetch('/responses', apiKey, {
    method: 'POST',
    body: JSON.stringify(buildOpenAIResponseRequest(body))
  });

  if (action === 'chat-intel-stream') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (!response.ok) {
      res.write?.(`data: ${JSON.stringify({
        error: await readOpenAIError(response, apiKey)
      })}\n\n`);
      res.end();
      return;
    }
    const compatible = openAIResponseToGemini(await response.json());
    res.write?.(`data: ${JSON.stringify({ text: compatible.text })}\n\n`);
    res.write?.('data: [DONE]\n\n');
    res.end();
    return;
  }

  if (!response.ok) {
    sendJson(res, response.status, {
      error: await readOpenAIError(response, apiKey)
    });
    return;
  }
  sendJson(res, 200, openAIResponseToGemini(await response.json()));
};

export const createOpenAIHttpHandler = (
  action: OpenAIHttpAction
) => async (
  req: NodeLikeRequest,
  res: NodeLikeResponse
): Promise<void> => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'POST, OPTIONS');
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendJson(res, 405, { error: 'Método não permitido.' });
    return;
  }

  let apiKey = '';
  try {
    const body = await readJsonBody(req);
    apiKey = getOpenAIKey(body);
    await handleOpenAIAction(action, body, res);
  } catch (error: any) {
    const status =
      error?.name === 'AbortError'
        ? 504
        : /JSON|4 MB|Corpo/.test(String(error?.message || ''))
          ? 400
          : 502;
    sendJson(res, status, {
      success: false,
      error: safeOpenAIError(error?.message, apiKey ? [apiKey] : [])
    });
  }
};
