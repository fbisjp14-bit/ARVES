import {
  enrichGeminiResponse,
  geminiApiFetch,
  normalizeGeminiApiKey
} from '../lib/geminiApi.js';
import {
  buildOpenAIResponseRequest,
  normalizeOpenAIKey,
  openAIResponseToGemini
} from '../lib/openaiCompatibility.js';
import { normalizeExternalHttpUrl } from '../lib/externalUrl.js';
import { redactSecrets } from '../lib/redaction.js';

const OPENAI_API_ROOT = 'https://api.openai.com/v1';
const REQUEST_TIMEOUT_MS = 55_000;
const GEMINI_TEXT_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash'
] as const;
const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';

export type ProviderName = 'gemini' | 'openai';
export type ProviderErrorKind =
  | 'auth'
  | 'quota'
  | 'unavailable'
  | 'timeout'
  | 'invalid_request'
  | 'safety'
  | 'empty_response'
  | 'missing_key'
  | 'unknown';

export class ProviderRequestError extends Error {
  status: number;
  provider: ProviderName;
  kind: ProviderErrorKind;
  fallbackAllowed: boolean;

  constructor(options: {
    provider: ProviderName;
    status: number;
    kind: ProviderErrorKind;
    message: string;
    fallbackAllowed?: boolean;
  }) {
    super(options.message);
    this.name = 'ProviderRequestError';
    this.status = options.status;
    this.provider = options.provider;
    this.kind = options.kind;
    this.fallbackAllowed =
      options.fallbackAllowed ??
      ['quota', 'unavailable', 'timeout', 'empty_response', 'missing_key']
        .includes(options.kind);
  }
}

type Fetcher = typeof fetch;

export interface ProviderRuntime {
  fetcher?: Fetcher;
}

const safeMessage = (
  value: unknown,
  secrets: unknown[] = []
): string =>
  redactSecrets(
    value || 'O provedor de IA não respondeu à solicitação.',
    secrets,
    700
  ) || 'O provedor de IA não respondeu à solicitação.';

const readProviderError = async (
  response: Response,
  secrets: unknown[] = []
): Promise<string> => {
  try {
    const body = await response.clone().json();
    return safeMessage(
      body?.error?.message ||
      body?.error?.status ||
      body?.message ||
      `HTTP ${response.status}`,
      secrets
    );
  } catch {
    return `HTTP ${response.status}`;
  }
};

const classifyStatus = (
  provider: ProviderName,
  status: number,
  message: string
): ProviderRequestError => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('safety') ||
    normalized.includes('blocked') ||
    normalized.includes('policy') ||
    normalized.includes('segurança')
  ) {
    return new ProviderRequestError({
      provider,
      status,
      kind: 'safety',
      message,
      fallbackAllowed: false
    });
  }
  if (status === 401 || status === 403) {
    return new ProviderRequestError({
      provider,
      status,
      kind: 'auth',
      message,
      fallbackAllowed: false
    });
  }
  if (status === 408 || status === 504) {
    return new ProviderRequestError({
      provider,
      status,
      kind: 'timeout',
      message
    });
  }
  if (status === 429) {
    return new ProviderRequestError({
      provider,
      status,
      kind: 'quota',
      message
    });
  }
  if (status === 404 || status >= 500) {
    return new ProviderRequestError({
      provider,
      status,
      kind: 'unavailable',
      message
    });
  }
  if (status >= 400 && status < 500) {
    return new ProviderRequestError({
      provider,
      status,
      kind: 'invalid_request',
      message,
      fallbackAllowed: false
    });
  }
  return new ProviderRequestError({
    provider,
    status,
    kind: 'unknown',
    message,
    fallbackAllowed: false
  });
};

const runWithTimeout = async (
  task: (signal: AbortSignal) => Promise<Response>
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const mapNetworkError = (
  provider: ProviderName,
  error: unknown,
  secrets: unknown[] = []
): ProviderRequestError => {
  if (error instanceof ProviderRequestError) return error;
  const isTimeout =
    (error as any)?.name === 'AbortError' ||
    /timeout|timed out|aborted/i.test(String((error as any)?.message || ''));
  return new ProviderRequestError({
    provider,
    status: isTimeout ? 504 : 502,
    kind: isTimeout ? 'timeout' : 'unavailable',
    message: safeMessage((error as any)?.message, secrets)
  });
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

/**
 * The older UI declares google_search as a client-side function. On the
 * server, convert that declaration to Gemini's native Google Search grounding
 * tool so research keeps working without a separate Custom Search key.
 */
export const normalizeGeminiTools = (
  source: any,
  researchMode: unknown
): any[] | undefined => {
  const tools = Array.isArray(source) ? source : [];
  const normalized: any[] = [];
  let shouldUseGoogleSearch = researchMode === 'deep';

  for (const tool of tools) {
    if (tool?.googleSearch || tool?.google_search) {
      shouldUseGoogleSearch = true;
      continue;
    }

    const declarations = Array.isArray(tool?.functionDeclarations)
      ? tool.functionDeclarations.filter((declaration: any) => {
          if (declaration?.name === 'google_search') {
            shouldUseGoogleSearch = true;
            return false;
          }
          return true;
        })
      : [];

    if (declarations.length > 0) {
      normalized.push({
        ...tool,
        functionDeclarations: declarations
      });
    } else if (!Array.isArray(tool?.functionDeclarations)) {
      normalized.push(tool);
    }
  }

  if (shouldUseGoogleSearch) normalized.unshift({ googleSearch: {} });
  return normalized.length > 0 ? normalized : undefined;
};

const buildGeminiRequest = (body: any): any => {
  const config = body?.config || {};
  const {
    systemInstruction,
    tools,
    toolConfig,
    safetySettings,
    cachedContent,
    abortSignal: _abortSignal,
    httpOptions: _httpOptions,
    ...generationConfig
  } = config;

  const requestBody: any = {
    contents: normalizeContents(
      body?.contents ??
      body?.historyContents ??
      body?.prompt ??
      ''
    )
  };
  const normalizedInstruction = normalizeSystemInstruction(
    systemInstruction ?? body?.systemInstruction
  );
  const normalizedTools = normalizeGeminiTools(
    tools,
    body?.openaiResearchMode
  );

  if (normalizedInstruction) {
    requestBody.systemInstruction = normalizedInstruction;
  }
  if (normalizedTools) requestBody.tools = normalizedTools;
  if (toolConfig) requestBody.toolConfig = toolConfig;
  if (safetySettings) requestBody.safetySettings = safetySettings;
  if (cachedContent) requestBody.cachedContent = cachedContent;
  if (Object.keys(generationConfig).length > 0) {
    requestBody.generationConfig = generationConfig;
  }
  return requestBody;
};

const extractGeminiCitations = (response: any): Array<{
  title: string;
  uri: string;
}> => {
  const citations = new Map<string, { title: string; uri: string }>();
  const candidates = Array.isArray(response?.candidates)
    ? response.candidates
    : [];
  for (const candidate of candidates) {
    const chunks = Array.isArray(candidate?.groundingMetadata?.groundingChunks)
      ? candidate.groundingMetadata.groundingChunks
      : [];
    for (const chunk of chunks) {
      const uri = normalizeExternalHttpUrl(chunk?.web?.uri);
      if (!uri) continue;
      citations.set(uri, {
        title: String(chunk?.web?.title || uri).slice(0, 500),
        uri
      });
    }
  }
  return [...citations.values()];
};

const enrichGeminiWithCitations = (response: any): any => {
  const enriched = enrichGeminiResponse(response);
  const citations = extractGeminiCitations(response);
  if (citations.length === 0) return enriched;

  const sourceBlock = citations
    .map((citation, index) =>
      `${index + 1}. [${citation.title}](${citation.uri})`
    )
    .join('\n');
  const baseText = String(enriched.text || '').trim();
  const text = `${baseText}${baseText ? '\n\n' : ''}### Fontes consultadas\n${sourceBlock}`;
  const candidates = Array.isArray(enriched.candidates)
    ? enriched.candidates
    : [];
  const firstCandidate = candidates[0] || {
    content: { role: 'model', parts: [] }
  };
  const existingParts = Array.isArray(firstCandidate?.content?.parts)
    ? firstCandidate.content.parts.filter(
        (part: any) => typeof part?.text !== 'string'
      )
    : [];

  return {
    ...enriched,
    text,
    citations,
    candidates: [
      {
        ...firstCandidate,
        content: {
          ...firstCandidate.content,
          role: firstCandidate?.content?.role || 'model',
          parts: [{ text }, ...existingParts]
        }
      },
      ...candidates.slice(1)
    ]
  };
};

const geminiModelCandidates = (requested: unknown): string[] => {
  const candidate = typeof requested === 'string' ? requested.trim() : '';
  return [...new Set([
    candidate || GEMINI_TEXT_MODELS[0],
    ...GEMINI_TEXT_MODELS
  ])];
};

const callGeminiText = async (
  body: any,
  apiKey: string,
  fetcher: Fetcher
): Promise<any> => {
  let lastError: ProviderRequestError | undefined;
  const requestBody = buildGeminiRequest(body);

  for (const model of geminiModelCandidates(body?.model)) {
    try {
      const response = await runWithTimeout((signal) =>
        geminiApiFetch(
          `/models/${encodeURIComponent(model)}:generateContent`,
          apiKey,
          {
            method: 'POST',
            body: JSON.stringify(requestBody),
            signal
          },
          fetcher
        )
      );
      if (!response.ok) {
        const error = classifyStatus(
          'gemini',
          response.status,
          await readProviderError(response, [apiKey])
        );
        lastError = error;
        if (error.kind === 'unavailable' || error.kind === 'quota') {
          continue;
        }
        throw error;
      }

      const compatible = enrichGeminiWithCitations(await response.json());
      const hasText = Boolean(String(compatible?.text || '').trim());
      const hasFunctionCalls =
        Array.isArray(compatible?.functionCalls) &&
        compatible.functionCalls.length > 0;
      const blockReason =
        compatible?.promptFeedback?.blockReason ||
        compatible?.candidates?.[0]?.finishReason;
      if (!hasText && !hasFunctionCalls) {
        if (/safety|blocked|prohibited/i.test(String(blockReason || ''))) {
          throw new ProviderRequestError({
            provider: 'gemini',
            status: 400,
            kind: 'safety',
            message: 'O Gemini bloqueou esta solicitação por segurança.',
            fallbackAllowed: false
          });
        }
        throw new ProviderRequestError({
          provider: 'gemini',
          status: 502,
          kind: 'empty_response',
          message: 'O Gemini respondeu sem conteúdo utilizável.'
        });
      }

      return {
        ...compatible,
        provider: 'gemini',
        model,
        fallbackUsed: false
      };
    } catch (error) {
      const mapped = mapNetworkError('gemini', error, [apiKey]);
      lastError = mapped;
      if (mapped.kind === 'unavailable' || mapped.kind === 'quota') {
        continue;
      }
      throw mapped;
    }
  }

  throw (
    lastError ||
    new ProviderRequestError({
      provider: 'gemini',
      status: 502,
      kind: 'unavailable',
      message: 'O Gemini não respondeu à solicitação.'
    })
  );
};

const callOpenAIResponse = async (
  body: any,
  apiKey: string,
  fetcher: Fetcher
): Promise<any> => {
  try {
    const response = await runWithTimeout((signal) =>
      fetcher(`${OPENAI_API_ROOT}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildOpenAIResponseRequest({
          ...body,
          openaiModel: 'gpt-5.6-sol'
        })),
        signal
      })
    );
    if (!response.ok) {
      throw classifyStatus(
        'openai',
        response.status,
        await readProviderError(response, [apiKey])
      );
    }
    const compatible = openAIResponseToGemini(await response.json());
    const hasText = Boolean(String(compatible?.text || '').trim());
    const hasFunctionCalls =
      Array.isArray(compatible?.functionCalls) &&
      compatible.functionCalls.length > 0;
    if (!hasText && !hasFunctionCalls) {
      throw new ProviderRequestError({
        provider: 'openai',
        status: 502,
        kind: 'empty_response',
        message: 'O GPT‑5.6 Sol respondeu sem conteúdo utilizável.'
      });
    }
    return compatible;
  } catch (error) {
    throw mapNetworkError('openai', error, [apiKey]);
  }
};

const providerKeys = (body: any): {
  gemini: string;
  openai: string;
} => ({
  gemini: normalizeGeminiApiKey(
    body?.clientApiKey ||
    body?.geminiApiKey ||
    process.env.GEMINI_API_KEY
  ),
  openai: normalizeOpenAIKey(
    body?.openaiApiKey ||
    body?.clientOpenAIApiKey ||
    process.env.OPENAI_API_KEY
  )
});

export const runTextWithFallback = async (
  body: any,
  runtime: ProviderRuntime = {}
): Promise<any> => {
  const fetcher = runtime.fetcher || fetch;
  const keys = providerKeys(body);
  const fallbackEnabled = body?.openaiFallbackEnabled !== false;
  let geminiError: ProviderRequestError | undefined;

  if (keys.gemini) {
    try {
      return await callGeminiText(body, keys.gemini, fetcher);
    } catch (error) {
      geminiError = mapNetworkError('gemini', error, [keys.gemini]);
      if (!geminiError.fallbackAllowed) throw geminiError;
    }
  } else {
    geminiError = new ProviderRequestError({
      provider: 'gemini',
      status: 400,
      kind: 'missing_key',
      message: 'A chave API do Gemini não foi configurada.'
    });
  }

  if (!fallbackEnabled || !keys.openai) {
    throw geminiError;
  }

  try {
    const compatible = await callOpenAIResponse(body, keys.openai, fetcher);
    return {
      ...compatible,
      provider: 'openai',
      model: 'gpt-5.6-sol',
      fallbackUsed: true,
      fallbackFrom: 'gemini',
      fallbackReason: geminiError?.kind || 'unavailable'
    };
  } catch (openAIError) {
    const mapped = mapNetworkError('openai', openAIError, [keys.openai]);
    throw new ProviderRequestError({
      provider: 'openai',
      status: mapped.status >= 400 ? mapped.status : 502,
      kind: mapped.kind,
      message:
        'Gemini e GPT‑5.6 Sol não conseguiram concluir esta solicitação. ' +
        `Gemini: ${safeMessage(geminiError?.message, [keys.gemini])} ` +
        `OpenAI: ${safeMessage(mapped.message, [keys.openai])}`,
      fallbackAllowed: false
    });
  }
};

const callGeminiImage = async (
  body: any,
  apiKey: string,
  fetcher: Fetcher
): Promise<any> => {
  const prompt = String(body?.prompt || '').trim();
  if (!prompt) {
    throw new ProviderRequestError({
      provider: 'gemini',
      status: 400,
      kind: 'invalid_request',
      message: 'Descreva a imagem que deseja gerar.',
      fallbackAllowed: false
    });
  }

  try {
    const response = await runWithTimeout((signal) =>
      geminiApiFetch(
        `/models/${GEMINI_IMAGE_MODEL}:generateContent`,
        apiKey,
        {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt.slice(0, 32_000) }] }],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: {
                aspectRatio: body?.config?.aspectRatio || '1:1',
                imageSize: body?.config?.imageSize || '1K'
              }
            }
          }),
          signal
        },
        fetcher
      )
    );
    if (!response.ok) {
      throw classifyStatus(
        'gemini',
        response.status,
        await readProviderError(response, [apiKey])
      );
    }
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part: any) => part?.inlineData?.data);
    if (!imagePart) {
      const blockReason =
        data?.promptFeedback?.blockReason ||
        data?.candidates?.[0]?.finishReason;
      throw new ProviderRequestError({
        provider: 'gemini',
        status: /safety|blocked|prohibited/i.test(String(blockReason || ''))
          ? 400
          : 502,
        kind: /safety|blocked|prohibited/i.test(String(blockReason || ''))
          ? 'safety'
          : 'empty_response',
        message: /safety|blocked|prohibited/i.test(String(blockReason || ''))
          ? 'O Gemini bloqueou esta imagem por segurança.'
          : 'O Gemini não retornou dados de imagem.',
        fallbackAllowed:
          !/safety|blocked|prohibited/i.test(String(blockReason || ''))
      });
    }
    return {
      provider: 'gemini',
      model: GEMINI_IMAGE_MODEL,
      fallbackUsed: false,
      outputMimeType:
        imagePart.inlineData.mimeType ||
        imagePart.inlineData.mime_type ||
        'image/png',
      generatedImages: [{
        image: { imageBytes: imagePart.inlineData.data }
      }]
    };
  } catch (error) {
    throw mapNetworkError('gemini', error, [apiKey]);
  }
};

export const runOpenAIImage = async (
  body: any,
  apiKey: string,
  runtime: ProviderRuntime = {}
): Promise<any> => {
  const prompt = String(body?.prompt || '').trim();
  if (!prompt) {
    throw new ProviderRequestError({
      provider: 'openai',
      status: 400,
      kind: 'invalid_request',
      message: 'Descreva a imagem que deseja gerar.',
      fallbackAllowed: false
    });
  }
  const fetcher = runtime.fetcher || fetch;

  try {
    const response = await runWithTimeout((signal) =>
      fetcher(`${OPENAI_API_ROOT}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-5.6-sol',
          input:
            'Crie uma imagem de alta qualidade seguindo fielmente esta descrição: ' +
            prompt.slice(0, 32_000),
          tools: [{ type: 'image_generation' }],
          tool_choice: { type: 'image_generation' },
          reasoning: { effort: 'low' },
          store: false
        }),
        signal
      })
    );
    if (!response.ok) {
      throw classifyStatus(
        'openai',
        response.status,
        await readProviderError(response, [apiKey])
      );
    }
    const data = await response.json();
    const imageCall = Array.isArray(data?.output)
      ? data.output.find(
          (item: any) =>
            item?.type === 'image_generation_call' &&
            typeof item?.result === 'string'
        )
      : undefined;
    if (!imageCall?.result) {
      throw new ProviderRequestError({
        provider: 'openai',
        status: 502,
        kind: 'empty_response',
        message: 'O GPT‑5.6 Sol não retornou dados de imagem.'
      });
    }
    return {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      imageTool: 'image_generation',
      outputMimeType: 'image/png',
      generatedImages: [{
        image: { imageBytes: imageCall.result }
      }]
    };
  } catch (error) {
    throw mapNetworkError('openai', error, [apiKey]);
  }
};

export const runImageWithFallback = async (
  body: any,
  runtime: ProviderRuntime = {}
): Promise<any> => {
  const fetcher = runtime.fetcher || fetch;
  const keys = providerKeys(body);
  const fallbackEnabled = body?.openaiFallbackEnabled !== false;
  let geminiError: ProviderRequestError | undefined;

  if (keys.gemini) {
    try {
      return await callGeminiImage(body, keys.gemini, fetcher);
    } catch (error) {
      geminiError = mapNetworkError('gemini', error, [keys.gemini]);
      if (!geminiError.fallbackAllowed) throw geminiError;
    }
  } else {
    geminiError = new ProviderRequestError({
      provider: 'gemini',
      status: 400,
      kind: 'missing_key',
      message: 'A chave API do Gemini não foi configurada.'
    });
  }

  if (!fallbackEnabled || !keys.openai) throw geminiError;

  try {
    const image = await runOpenAIImage(body, keys.openai, { fetcher });
    return {
      ...image,
      fallbackUsed: true,
      fallbackFrom: 'gemini',
      fallbackReason: geminiError?.kind || 'unavailable'
    };
  } catch (openAIError) {
    const mapped = mapNetworkError('openai', openAIError, [keys.openai]);
    throw new ProviderRequestError({
      provider: 'openai',
      status: mapped.status >= 400 ? mapped.status : 502,
      kind: mapped.kind,
      message:
        'Gemini e GPT‑5.6 Sol não conseguiram gerar a imagem. ' +
        `Gemini: ${safeMessage(geminiError?.message, [keys.gemini])} ` +
        `OpenAI: ${safeMessage(mapped.message, [keys.openai])}`,
      fallbackAllowed: false
    });
  }
};
