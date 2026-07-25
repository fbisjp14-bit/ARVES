import {
  geminiApiFetch,
  normalizeGeminiApiKey
} from '../lib/geminiApi.ts';
import { redactSecrets } from '../lib/redaction.ts';

const REQUEST_TIMEOUT_MS = 55_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

type NodeLikeRequest = {
  method?: string;
  body?: unknown;
  on?: (event: string, listener: (chunk?: unknown) => void) => void;
};

type NodeLikeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Uint8Array) => void;
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

const fetchWithTimeout = async (
  input: string,
  init: RequestInit
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const readApiError = async (
  response: Response,
  secrets: string[]
): Promise<string> => {
  try {
    const data = await response.clone().json();
    return redactSecrets(
      data?.error?.message ||
      data?.detail?.message ||
      data?.message ||
      `HTTP ${response.status}`,
      secrets
    );
  } catch {
    return `HTTP ${response.status}`;
  }
};

const synthesizeElevenLabs = async (
  body: Record<string, any>,
  text: string
): Promise<{ audio: Buffer; contentType: string; mode: string }> => {
  const apiKey = normalizeGeminiApiKey(
    body.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY
  );
  const voiceId = String(
    body.elevenLabsVoiceId ||
    process.env.ELEVENLABS_VOICE_ID ||
    '21m00Tcm4TlvDq8ikWAM'
  );
  if (!apiKey) {
    throw Object.assign(
      new Error('Chave ElevenLabs não configurada. Selecione a voz neural Gemini ou configure a ElevenLabs.'),
      { status: 400 }
    );
  }

  const response = await fetchWithTimeout(
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
        model_id: body.elevenLabsModel || 'eleven_turbo_v2_5',
        voice_settings: {
          stability: body.elevenLabsStability ?? 0.5,
          similarity_boost: body.elevenLabsSimilarityBoost ?? 0.75,
          style: body.elevenLabsStyle ?? 0,
          use_speaker_boost: body.elevenLabsSpeakerBoost ?? true
        }
      })
    }
  );
  if (!response.ok) {
    throw Object.assign(
      new Error(await readApiError(response, [apiKey])),
      { status: response.status }
    );
  }

  return {
    audio: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'audio/mpeg',
    mode: 'elevenlabs'
  };
};

const synthesizeGemini = async (
  body: Record<string, any>,
  text: string
): Promise<{ audio: Buffer; contentType: string; mode: string }> => {
  const apiKey = normalizeGeminiApiKey(
    body.clientApiKey ||
    body.geminiApiKey ||
    process.env.GEMINI_API_KEY
  );
  if (!apiKey) {
    throw Object.assign(
      new Error('Chave Gemini não configurada para a voz neural. A voz simples do navegador foi removida.'),
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await geminiApiFetch(
      '/models/gemini-3.1-flash-tts-preview:generateContent',
      apiKey,
      {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{
              text: `Leia com clareza, naturalidade e emoção:\n\n${text.slice(0, 4_000)}`
            }]
          }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: String(body.voice || 'Kore')
                }
              }
            }
          }
        })
      }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(await readApiError(response, [apiKey])),
      { status: response.status }
    );
  }

  const data = await response.json();
  const audioPart = data?.candidates?.[0]?.content?.parts?.find(
    (part: any) => part?.inlineData?.data
  );
  if (!audioPart) {
    throw Object.assign(
      new Error('O Gemini concluiu a solicitação, mas não retornou áudio.'),
      { status: 502 }
    );
  }

  const audio = Buffer.from(audioPart.inlineData.data, 'base64');
  const mimeType = String(
    audioPart.inlineData.mimeType || 'audio/mpeg'
  ).toLowerCase();
  if (mimeType.includes('pcm') || mimeType.includes('l16')) {
    return {
      audio: pcmToWav(audio),
      contentType: 'audio/wav',
      mode: 'gemini'
    };
  }
  return {
    audio,
    contentType: audioPart.inlineData.mimeType || 'audio/mpeg',
    mode: 'gemini'
  };
};

export default async function ttsHttpHandler(
  req: NodeLikeRequest,
  res: NodeLikeResponse
): Promise<void> {
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

  try {
    const body = await readJsonBody(req);
    const text = String(body.text || '').trim();
    if (!text) {
      sendJson(res, 400, { error: 'O texto é obrigatório.' });
      return;
    }

    const result =
      body.engine === 'elevenlabs'
        ? await synthesizeElevenLabs(body, text)
        : await synthesizeGemini(body, text);
    res.statusCode = 200;
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.audio.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-TTS-Mode', result.mode);
    res.end(result.audio);
  } catch (error: any) {
    const status =
      typeof error?.status === 'number'
        ? error.status
        : error?.name === 'AbortError'
          ? 504
          : /JSON|4 MB|Corpo/.test(String(error?.message || ''))
            ? 400
            : 502;
    sendJson(res, status, {
      error:
        redactSecrets(error?.message) ||
        'Não foi possível gerar a voz neural.'
    });
  }
}
