import express from 'express';
import {
  enrichGeminiResponse,
  geminiApiFetch,
  normalizeGeminiApiKey,
  verifyGeminiApiKey
} from '../src/lib/geminiApi.ts';

const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

const textFromGemini = (response: any): string => {
  return enrichGeminiResponse(response).text || '';
};

const normalizeContents = (contents: any): any[] => {
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }

  if (Array.isArray(contents)) return contents;

  if (contents?.parts) {
    return [{ role: contents.role || 'user', parts: contents.parts }];
  }

  return [];
};

const normalizeSystemInstruction = (instruction: any): any => {
  if (!instruction) return undefined;
  if (typeof instruction === 'string') {
    return { parts: [{ text: instruction }] };
  }
  return instruction;
};

const buildGenerateRequest = (contents: any, config: any = {}): any => {
  const requestBody: any = {
    contents: normalizeContents(contents)
  };

  const {
    systemInstruction,
    tools,
    toolConfig,
    safetySettings,
    cachedContent,
    abortSignal: _abortSignal,
    httpOptions: _httpOptions,
    ...generationConfig
  } = config || {};

  const normalizedInstruction = normalizeSystemInstruction(systemInstruction);
  if (normalizedInstruction) requestBody.systemInstruction = normalizedInstruction;
  if (tools) requestBody.tools = tools;
  if (toolConfig) requestBody.toolConfig = toolConfig;
  if (safetySettings) requestBody.safetySettings = safetySettings;
  if (cachedContent) requestBody.cachedContent = cachedContent;
  if (Object.keys(generationConfig).length > 0) {
    requestBody.generationConfig = generationConfig;
  }

  return requestBody;
};

class GeminiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const readApiError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
};

const generateGeminiContent = async (
  apiKey: string,
  model: string,
  contents: any,
  config: any = {}
): Promise<any> => {
  const models = Array.from(new Set([
    model || 'gemini-3.5-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash'
  ]));

  let lastError: GeminiRequestError | null = null;

  for (const candidate of models) {
    const response = await geminiApiFetch(
      `/models/${encodeURIComponent(candidate)}:generateContent`,
      apiKey,
      {
        method: 'POST',
        body: JSON.stringify(buildGenerateRequest(contents, config))
      }
    );

    if (response.ok) return response.json();

    const error = new GeminiRequestError(
      response.status,
      await readApiError(response)
    );
    lastError = error;

    if (![404, 429, 503].includes(response.status)) throw error;
  }

  throw lastError || new GeminiRequestError(500, 'A API do Gemini não respondeu.');
};

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
    error: error?.message || 'Erro interno ao processar a solicitação.'
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
    const apiKey = getGeminiKey(req.body);
    if (!apiKey) {
      return res.status(400).json({
        error: 'Chave API do Gemini não definida. Insira uma chave válida nos Ajustes.'
      });
    }

    const response = await generateGeminiContent(
      apiKey,
      req.body?.model || 'gemini-3.5-flash',
      req.body?.contents,
      req.body?.config
    );

    return res.json(enrichGeminiResponse(response));
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const apiKey = getGeminiKey(req.body);
    if (!apiKey) {
      return res.status(400).json({ error: 'Chave API do Gemini não definida.' });
    }

    const response = await generateGeminiContent(
      apiKey,
      req.body?.model || 'gemini-3.5-flash',
      req.body?.prompt || '',
      {
        ...(req.body?.systemInstruction
          ? { systemInstruction: req.body.systemInstruction }
          : {}),
        ...(req.body?.responseMimeType
          ? { responseMimeType: req.body.responseMimeType }
          : {})
      }
    );

    return res.json({ text: textFromGemini(response) });
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/chat-intel', async (req, res) => {
  try {
    const apiKey = getGeminiKey(req.body);
    if (!apiKey) {
      return res.status(400).json({ error: 'Chave API do Gemini não definida.' });
    }

    const response = await generateGeminiContent(
      apiKey,
      req.body?.model || 'gemini-3.5-flash',
      req.body?.historyContents || req.body?.contents,
      {
        maxOutputTokens: 250,
        temperature: 0.7,
        systemInstruction: req.body?.systemInstruction
      }
    );

    return res.json({ text: textFromGemini(response) });
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/chat-intel-stream', async (req, res) => {
  try {
    const apiKey = getGeminiKey(req.body);
    if (!apiKey) {
      return res.status(400).json({ error: 'Chave API do Gemini não definida.' });
    }

    const response = await generateGeminiContent(
      apiKey,
      req.body?.model || 'gemini-3.5-flash',
      req.body?.historyContents || req.body?.contents,
      {
        maxOutputTokens: 250,
        temperature: 0.7,
        systemInstruction: req.body?.systemInstruction
      }
    );

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.write(`data: ${JSON.stringify({ text: textFromGemini(response) })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  } catch (error: any) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.write(`data: ${JSON.stringify({ error: error?.message || 'Falha na geração.' })}\n\n`);
    return res.end();
  }
});

app.post('/api/gemini/generateImages', async (req, res) => {
  try {
    const apiKey = getGeminiKey(req.body);
    if (!apiKey) {
      return res.status(400).json({ error: 'Chave API do Gemini não definida.' });
    }

    const response = await generateGeminiContent(
      apiKey,
      req.body?.model || 'gemini-3.1-flash-image',
      { parts: [{ text: req.body?.prompt || '' }] },
      {
        imageConfig: {
          aspectRatio: req.body?.config?.aspectRatio || '1:1',
          imageSize: req.body?.config?.imageSize || '1K'
        }
      }
    );

    const parts = response?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part: any) => part?.inlineData?.data);
    if (!imagePart) {
      throw new GeminiRequestError(502, 'O Gemini não retornou dados de imagem.');
    }

    return res.json({
      generatedImages: [{
        image: {
          imageBytes: imagePart.inlineData.data
        }
      }]
    });
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

const isBlockedScrapeTarget = (target: URL): boolean => {
  const host = target.hostname.toLowerCase();
  return (
    !['http:', 'https:'].includes(target.protocol) ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
};

app.post('/api/scrape', async (req, res) => {
  try {
    const target = new URL(String(req.body?.url || ''));
    if (isBlockedScrapeTarget(target)) {
      return res.status(400).json({ error: 'Endereço não permitido para leitura.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OSONE/3.0; +https://vercel.app)'
      }
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      return res.status(400).json({
        error: `Falha ao acessar a página (HTTP ${response.status}).`
      });
    }

    const html = (await response.text()).slice(0, 1_000_000);
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
    return res.status(400).json({ error: 'URL inválida ou página inacessível.' });
  }
});

app.post('/api/lens/query', async (req, res) => {
  try {
    const apiKey = getGeminiKey(req.body);
    const image = String(req.body?.image || '');
    if (!apiKey) return res.status(400).json({ error: 'Chave Gemini não definida.' });
    if (!image) return res.status(400).json({ error: 'A imagem é obrigatória.' });

    const match = image.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match?.[1] || 'image/jpeg';
    const base64Data = match?.[2] || image;
    const response = await generateGeminiContent(
      apiKey,
      'gemini-3.5-flash',
      {
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          {
            text: 'Identifique detalhadamente a imagem. Responda em JSON com name, category, confidence, description, tags, details e suggestions.'
          }
        ]
      },
      {
        responseMimeType: 'application/json',
        ...(req.body?.internetSearch ? { tools: [{ googleSearch: {} }] } : {})
      }
    );

    const rawText = textFromGemini(response)
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const result = JSON.parse(rawText || '{}');
    const grounding = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    result.citations = grounding
      .filter((chunk: any) => chunk?.web?.uri)
      .map((chunk: any) => ({
        title: chunk.web.title || 'Resultado da Web',
        uri: chunk.web.uri
      }));

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

const pcmToWav = (pcm: Buffer, sampleRate = 24_000): Buffer => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

app.post('/api/tts', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'O texto é obrigatório.' });

    if (req.body?.engine === 'elevenlabs') {
      const apiKey = normalizeGeminiApiKey(
        req.body?.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY
      );
      const voiceId = String(
        req.body?.elevenLabsVoiceId ||
        process.env.ELEVENLABS_VOICE_ID ||
        '21m00Tcm4TlvDq8ikWAM'
      );
      if (!apiKey) return res.status(400).json({ error: 'Chave ElevenLabs não configurada.' });

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg'
          },
          body: JSON.stringify({
            text: text.slice(0, 5_000),
            model_id: req.body?.elevenLabsModel || 'eleven_turbo_v2_5',
            voice_settings: {
              stability: req.body?.elevenLabsStability ?? 0.5,
              similarity_boost: req.body?.elevenLabsSimilarityBoost ?? 0.75,
              style: req.body?.elevenLabsStyle ?? 0,
              use_speaker_boost: req.body?.elevenLabsSpeakerBoost ?? true
            }
          })
        }
      );

      if (!response.ok) {
        return res.status(response.status).json({
          error: `A ElevenLabs recusou a síntese (HTTP ${response.status}).`
        });
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(Buffer.from(await response.arrayBuffer()));
    }

    const apiKey = getGeminiKey(req.body);
    if (!apiKey) return res.status(400).json({ error: 'Chave Gemini não configurada.' });

    const response = await generateGeminiContent(
      apiKey,
      'gemini-3.1-flash-tts-preview',
      `Leia com clareza, naturalidade e emoção:\n\n${text.slice(0, 4_000)}`,
      {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: req.body?.voice || 'Kore'
            }
          }
        }
      }
    );
    const audioPart = response?.candidates?.[0]?.content?.parts?.find(
      (part: any) => part?.inlineData?.data
    );
    if (!audioPart) throw new GeminiRequestError(502, 'O Gemini não retornou áudio.');

    const audio = Buffer.from(audioPart.inlineData.data, 'base64');
    const mimeType = String(audioPart.inlineData.mimeType || '').toLowerCase();
    if (mimeType.includes('pcm') || mimeType.includes('l16')) {
      res.setHeader('Content-Type', 'audio/wav');
      return res.send(pcmToWav(audio));
    }

    res.setHeader('Content-Type', audioPart.inlineData.mimeType || 'audio/mpeg');
    return res.send(audio);
  } catch (error) {
    return sendError(res, error);
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({
    error: 'Esta função não está disponível no ambiente serverless da Vercel.'
  });
});

export default app;
