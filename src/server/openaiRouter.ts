import express from 'express';
import {
  buildOpenAIResponseRequest,
  normalizeOpenAIKey,
  openAIResponseToGemini
} from '../lib/openaiCompatibility.js';
import { redactSecrets } from '../lib/redaction.js';

const OPENAI_API_ROOT = 'https://api.openai.com/v1';
const REQUEST_TIMEOUT_MS = 55_000;
const safeOpenAIError = (value: unknown): string =>
  redactSecrets(value || 'A OpenAI não respondeu à solicitação.') ||
  'A OpenAI não respondeu à solicitação.';

const getOpenAIKey = (body: any): string => {
  return normalizeOpenAIKey(
    body?.openaiApiKey ||
    body?.clientOpenAIApiKey ||
    process.env.OPENAI_API_KEY
  );
};

const readOpenAIError = async (response: Response): Promise<string> => {
  try {
    const body = await response.clone().json();
    return safeOpenAIError(
      body?.error?.message ||
      body?.message ||
      `HTTP ${response.status}`
    );
  } catch {
    return `HTTP ${response.status}`;
  }
};

const requireOpenAIKey = (
  req: express.Request,
  res: express.Response
): string | null => {
  const apiKey = getOpenAIKey(req.body);
  if (!apiKey) {
    res.status(400).json({
      error: 'Chave API da OpenAI não definida. Insira sua chave nos Ajustes ou configure OPENAI_API_KEY na Vercel.'
    });
    return null;
  }
  return apiKey;
};

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

const sendOpenAIError = async (
  res: express.Response,
  response: Response
): Promise<express.Response> => {
  return res.status(response.status).json({
    error: await readOpenAIError(response)
  });
};

export const createOpenAIRouter = (): express.Router => {
  const router = express.Router();

  router.post('/verify', async (req, res) => {
    const apiKey = requireOpenAIKey(req, res);
    if (!apiKey) return;

    try {
      const response = await openAIFetch('/models', apiKey, {
        method: 'GET'
      });
      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          message: await readOpenAIError(response)
        });
      }
      return res.json({
        success: true,
        message: 'Conexão com a OpenAI validada. Chat, pesquisa e imagens estão disponíveis.'
      });
    } catch (error: any) {
      return res.status(error?.name === 'AbortError' ? 504 : 502).json({
        success: false,
        message: safeOpenAIError(error?.message)
      });
    }
  });

  router.post('/generate-compatible', async (req, res) => {
    const apiKey = requireOpenAIKey(req, res);
    if (!apiKey) return;

    try {
      const response = await openAIFetch('/responses', apiKey, {
        method: 'POST',
        body: JSON.stringify(buildOpenAIResponseRequest(req.body))
      });
      if (!response.ok) return sendOpenAIError(res, response);
      return res.json(openAIResponseToGemini(await response.json()));
    } catch (error: any) {
      return res.status(error?.name === 'AbortError' ? 504 : 502).json({
        error: safeOpenAIError(error?.message)
      });
    }
  });

  router.post('/chat-intel-stream', async (req, res) => {
    const apiKey = requireOpenAIKey(req, res);
    if (!apiKey) return;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    try {
      const response = await openAIFetch('/responses', apiKey, {
        method: 'POST',
        body: JSON.stringify(buildOpenAIResponseRequest(req.body))
      });
      if (!response.ok) {
        res.write(`data: ${JSON.stringify({ error: await readOpenAIError(response) })}\n\n`);
        return res.end();
      }
      const compatible = openAIResponseToGemini(await response.json());
      res.write(`data: ${JSON.stringify({ text: compatible.text })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: safeOpenAIError(error?.message) })}\n\n`);
      return res.end();
    }
  });

  router.post('/images', async (req, res) => {
    const apiKey = requireOpenAIKey(req, res);
    if (!apiKey) return;

    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({
        error: 'Descreva a imagem que deseja gerar.'
      });
    }

    try {
      const response = await openAIFetch('/images/generations', apiKey, {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt: prompt.slice(0, 32_000),
          n: 1,
          quality: req.body?.openaiImageQuality === 'medium' ? 'medium' : 'high',
          size: aspectRatioToSize(req.body?.config?.aspectRatio),
          output_format: 'png',
          moderation: 'auto'
        })
      });
      if (!response.ok) return sendOpenAIError(res, response);

      const imageResponse = await response.json();
      const imageBytes = imageResponse?.data?.[0]?.b64_json;
      if (!imageBytes) {
        return res.status(502).json({
          error: 'A OpenAI concluiu a solicitação, mas não retornou os dados da imagem.'
        });
      }

      return res.json({
        provider: 'openai',
        model: 'gpt-image-2',
        outputMimeType: 'image/png',
        generatedImages: [{
          image: { imageBytes }
        }]
      });
    } catch (error: any) {
      return res.status(error?.name === 'AbortError' ? 504 : 502).json({
        error: safeOpenAIError(error?.message)
      });
    }
  });

  return router;
};
