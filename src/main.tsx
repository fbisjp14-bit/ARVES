import React, { StrictMode, Component, ReactNode, ErrorInfo } from 'react';
import {createRoot} from 'react-dom/client';

// Safe global process mockup for client-side static environments (e.g. Vercel)
if (typeof window !== 'undefined') {
  const g = window as any;
  g.process = g.process || {};
  g.process.env = g.process.env || {};
  if (typeof g.process.env.GEMINI_API_KEY === 'undefined') {
    g.process.env.GEMINI_API_KEY = '';
  }
}

// --- Robust API bridge: use the deployed backend first and only fall back to direct Google calls on static hosts ---
const originalFetch = window.fetch.bind(window);

const GEMINI_TEXT_MODEL_FALLBACKS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
];

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" }
});

const parseRequestBody = (init?: RequestInit): any => {
  if (!init?.body || typeof init.body !== "string") return {};
  try {
    return JSON.parse(init.body);
  } catch (_) {
    return {};
  }
};

const readStoredGeminiSettings = (): { apiKey: string; model: string } => {
  try {
    const stored = localStorage.getItem("osone_api_keys");
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        apiKey: String(parsed.gemini || "").trim(),
        model: String(parsed.geminiModel || "gemini-3.5-flash")
      };
    }
  } catch (_) {}
  return { apiKey: "", model: "gemini-3.5-flash" };
};

const appendApiKey = (url: string, apiKey: string): string => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}key=${encodeURIComponent(apiKey)}`;
};

/**
 * Auth keys should be sent through x-goog-api-key. The query-string retry keeps
 * compatibility with older standard keys and unusual browser/CORS environments.
 */
const googleApiFetch = async (url: string, apiKey: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers || {});
  headers.set("x-goog-api-key", apiKey);
  try {
    return await originalFetch(url, { ...init, headers });
  } catch (firstError) {
    headers.delete("x-goog-api-key");
    return originalFetch(appendApiKey(url, apiKey), { ...init, headers });
  }
};

interface ParsedGoogleError {
  status: number;
  code: number;
  message: string;
  apiStatus: string;
  quotaMetric: string;
  quotaValue: string;
  retryDelay: string;
}

const parseGoogleError = async (response: Response): Promise<ParsedGoogleError> => {
  let payload: any = {};
  try {
    payload = await response.clone().json();
  } catch (_) {
    try {
      payload = { error: { message: await response.clone().text() } };
    } catch (_) {}
  }

  const error = payload?.error || payload || {};
  const details = Array.isArray(error?.details) ? error.details : [];
  const quotaFailure = details.find((item: any) => String(item?.["@type"] || "").includes("QuotaFailure"));
  const retryInfo = details.find((item: any) => String(item?.["@type"] || "").includes("RetryInfo"));
  const violation = quotaFailure?.violations?.[0] || {};

  return {
    status: response.status,
    code: Number(error?.code || response.status || 500),
    message: String(error?.message || "Falha desconhecida na API do Gemini."),
    apiStatus: String(error?.status || ""),
    quotaMetric: String(violation?.quotaMetric || violation?.quotaId || ""),
    quotaValue: String(violation?.quotaValue || ""),
    retryDelay: String(retryInfo?.retryDelay || "")
  };
};

const friendlyGeminiError = (error: ParsedGoogleError, attemptedModels: string[] = []): string => {
  const raw = `${error.message} ${error.apiStatus} ${error.quotaMetric}`.toLowerCase();
  const attempted = attemptedModels.length > 0 ? ` Modelos testados: ${attemptedModels.join(", ")}.` : "";

  if (error.status === 429 || raw.includes("resource_exhausted") || raw.includes("quota")) {
    const isDaily = raw.includes("perday") || raw.includes("per_day") || raw.includes("requestsperday");
    const limitText = error.quotaValue ? ` Limite informado pelo Google: ${error.quotaValue}.` : "";
    const retryText = error.retryDelay ? ` Tente novamente em aproximadamente ${error.retryDelay}.` : "";
    const periodText = isDaily
      ? " A cota diária gratuita deste projeto/modelo foi esgotada. Ela reinicia conforme o ciclo do Google."
      : " O projeto atingiu um limite temporário de requisições, tokens ou gastos.";
    return `A chave API foi aceita, mas o Google bloqueou a geração por limite de cota (erro 429).${periodText}${limitText}${retryText} O limite é aplicado ao projeto, não apenas à chave; criar outra chave no mesmo projeto não aumenta a cota.${attempted}`;
  }

  if (error.status === 401 || error.status === 403 || raw.includes("api_key_invalid") || raw.includes("permission_denied")) {
    return "Chave API inválida, bloqueada ou sem permissão para a Gemini API. Gere uma chave do Gemini no Google AI Studio e confirme que o projeto está ativo.";
  }

  if (error.status === 400) {
    return `O Google rejeitou a solicitação. Verifique a chave, o modelo e os parâmetros enviados. Detalhe: ${error.message}`;
  }

  if (error.status === 404) {
    return `O modelo solicitado não está disponível para esta chave ou versão da API.${attempted}`;
  }

  if (error.status === 503 || raw.includes("unavailable")) {
    return `O Gemini está temporariamente indisponível ou congestionado. Aguarde alguns segundos e tente novamente.${attempted}`;
  }

  return `Falha na API do Gemini: ${error.message}`;
};

const buildModelCandidates = (preferredModel: string): string[] => Array.from(new Set([
  preferredModel,
  ...GEMINI_TEXT_MODEL_FALLBACKS
].filter(Boolean)));

const directGenerateContentWithFallback = async (
  apiKey: string,
  preferredModel: string,
  payload: any
): Promise<{ response: Response; data?: any; attemptedModels: string[]; lastError?: ParsedGoogleError }> => {
  const models = buildModelCandidates(preferredModel);
  const attemptedModels: string[] = [];
  let lastResponse: Response | null = null;
  let lastError: ParsedGoogleError | undefined;

  for (const model of models) {
    attemptedModels.push(model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await googleApiFetch(url, apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      return { response, data: await response.json(), attemptedModels };
    }

    lastResponse = response;
    lastError = await parseGoogleError(response);

    // Authentication and malformed-request errors will not improve by changing models.
    if ([400, 401, 403].includes(response.status)) break;

    // 404, 429, 500 and 503 can be model-specific, so continue to the next stable model.
    if (![404, 429, 500, 503].includes(response.status)) break;
  }

  return {
    response: lastResponse || jsonResponse({ error: "Nenhum modelo Gemini pôde ser consultado." }, 500),
    attemptedModels,
    lastError
  };
};

const buildRestGenerationPayload = (reqBody: any, contents: any): any => {
  const config = reqBody.config || {};
  const payload: any = { contents };
  const systemInstruction = config.systemInstruction || reqBody.systemInstruction;

  if (systemInstruction) {
    payload.systemInstruction = typeof systemInstruction === "string"
      ? { parts: [{ text: systemInstruction }] }
      : systemInstruction;
  }

  const generationConfig: any = {};
  const generationKeys = [
    "temperature", "topP", "topK", "candidateCount", "maxOutputTokens",
    "stopSequences", "responseMimeType", "responseSchema", "seed",
    "presencePenalty", "frequencyPenalty"
  ];
  for (const key of generationKeys) {
    if (config[key] !== undefined) generationConfig[key] = config[key];
  }
  if (reqBody.responseMimeType !== undefined) generationConfig.responseMimeType = reqBody.responseMimeType;
  if (Object.keys(generationConfig).length > 0) payload.generationConfig = generationConfig;

  if (config.tools) payload.tools = config.tools;
  if (config.toolConfig) payload.toolConfig = config.toolConfig;
  if (config.safetySettings) payload.safetySettings = config.safetySettings;
  if (config.cachedContent) payload.cachedContent = config.cachedContent;

  return payload;
};

const customFetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (!urlStr.includes("/api/")) return originalFetch(input, init);

  const isGeminiContentProxy = urlStr.includes("/api/gemini/generateContent") || urlStr.includes("/api/chat-intel");
  const isGeminiGenerateProxy = urlStr.includes("/api/generate");
  const isGeminiImageProxy = urlStr.includes("/api/gemini/generateImages");
  const isGeminiVerifyProxy = urlStr.includes("/api/gemini/verify");
  const isElevenlabsVerifyProxy = urlStr.includes("/api/elevenlabs/verify");
  const isMemorySyncSave = urlStr.includes("/api/memory-sync/save");
  const isMemorySyncLoad = urlStr.includes("/api/memory-sync/load/");

  const isHandledEndpoint = isGeminiContentProxy || isGeminiGenerateProxy || isGeminiImageProxy ||
    isGeminiVerifyProxy || isElevenlabsVerifyProxy || isMemorySyncSave || isMemorySyncLoad;

  if (!isHandledEndpoint) return originalFetch(input, init);

  // Vercel has a real serverless API in this project. Do not bypass it automatically.
  const hostname = window.location.hostname;
  const definitelyStaticHost = hostname.includes("github.io") || hostname.includes("netlify.app");
  let backendResponse: Response | null = null;
  let useDirectFallback = definitelyStaticHost;

  if (!definitelyStaticHost) {
    try {
      backendResponse = await originalFetch(input, init);
      const contentType = backendResponse.headers.get("content-type") || "";
      const backendUnavailable = [404, 405, 502, 504].includes(backendResponse.status) ||
        (contentType.includes("text/html") && urlStr.includes("/api/"));

      if (!backendUnavailable) return backendResponse;
      useDirectFallback = true;
    } catch (_) {
      useDirectFallback = true;
    }
  }

  if (!useDirectFallback && backendResponse) return backendResponse;

  const reqBody = parseRequestBody(init);
  const stored = readStoredGeminiSettings();
  const clientApiKey = String(reqBody.clientApiKey || reqBody.geminiApiKey || stored.apiKey || "").trim();
  const preferredModel = String(reqBody.model || stored.model || "gemini-3.5-flash");

  if (isGeminiVerifyProxy) {
    if (!clientApiKey) {
      return jsonResponse({ success: false, message: "Insira uma chave API do Gemini antes de testar." }, 400);
    }

    try {
      // Listing models validates authentication without consuming a generateContent quota request.
      const verifyResponse = await googleApiFetch(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        clientApiKey,
        { method: "GET" }
      );

      if (!verifyResponse.ok) {
        const parsedError = await parseGoogleError(verifyResponse);
        return jsonResponse({
          success: false,
          message: friendlyGeminiError(parsedError),
          code: parsedError.code
        }, verifyResponse.status);
      }

      const data = await verifyResponse.json();
      const availableModels = (Array.isArray(data?.models) ? data.models : [])
        .filter((model: any) => Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
        .map((model: any) => String(model.name || "").replace(/^models\//, ""))
        .filter(Boolean);

      return jsonResponse({
        success: true,
        message: `Chave aceita pelo Google. Handshake concluído sem consumir sua cota de geração. ${availableModels.length} modelos de texto foram detectados.`,
        availableModels
      });
    } catch (err: any) {
      return jsonResponse({
        success: false,
        message: `Não foi possível alcançar a API do Google: ${err?.message || "erro de rede"}.`
      }, 503);
    }
  }

  if (isGeminiContentProxy || isGeminiGenerateProxy) {
    if (!clientApiKey) {
      return jsonResponse({ error: "Configure uma chave API válida do Gemini na aba Ajustes." }, 400);
    }

    const contents = isGeminiGenerateProxy
      ? [{ role: "user", parts: [{ text: String(reqBody.prompt || "") }] }]
      : (reqBody.contents || reqBody.historyContents || []);
    const payload = buildRestGenerationPayload(reqBody, contents);

    try {
      const result = await directGenerateContentWithFallback(clientApiKey, preferredModel, payload);
      if (!result.data) {
        const parsedError = result.lastError || await parseGoogleError(result.response);
        return jsonResponse({
          error: friendlyGeminiError(parsedError, result.attemptedModels),
          code: parsedError.code,
          keyValid: parsedError.status === 429,
          attemptedModels: result.attemptedModels
        }, parsedError.status || 500);
      }

      const textResult = result.data?.candidates?.[0]?.content?.parts
        ?.filter((part: any) => typeof part?.text === "string")
        .map((part: any) => part.text)
        .join("") || "";

      if (isGeminiGenerateProxy) {
        return jsonResponse({ text: textResult, candidates: result.data.candidates });
      }

      return jsonResponse({
        ...result.data,
        text: textResult,
        candidates: result.data.candidates
      });
    } catch (err: any) {
      return jsonResponse({ error: `Falha de rede ao consultar o Gemini: ${err?.message || "erro desconhecido"}.` }, 503);
    }
  }

  if (isGeminiImageProxy) {
    if (!clientApiKey) return jsonResponse({ error: "Configure uma chave API válida do Gemini na aba Ajustes." }, 400);

    try {
      const selectedModel = String(reqBody.model || "gemini-3.1-flash-image");
      const prompt = String(reqBody.prompt || "");
      const aspectRatio = reqBody.config?.aspectRatio || "1:1";
      const imageSize = reqBody.config?.imageSize || "1K";

      if (selectedModel.startsWith("gemini-")) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`;
        const directResponse = await googleApiFetch(endpoint, clientApiKey, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: { aspectRatio, imageSize }
            }
          })
        });

        if (!directResponse.ok) {
          const parsedError = await parseGoogleError(directResponse);
          return jsonResponse({ error: friendlyGeminiError(parsedError) }, directResponse.status);
        }

        const data = await directResponse.json();
        const inlineData = data?.candidates?.[0]?.content?.parts?.find((part: any) => part?.inlineData)?.inlineData;
        if (!inlineData?.data) return jsonResponse({ error: "O Gemini respondeu sem dados de imagem." }, 502);

        return jsonResponse({
          generatedImages: [{ image: { imageBytes: inlineData.data }, mimeType: inlineData.mimeType }]
        });
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateImages`;
      const directResponse = await googleApiFetch(endpoint, clientApiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ...reqBody.config })
      });
      if (!directResponse.ok) {
        const parsedError = await parseGoogleError(directResponse);
        return jsonResponse({ error: friendlyGeminiError(parsedError) }, directResponse.status);
      }
      return jsonResponse(await directResponse.json());
    } catch (err: any) {
      return jsonResponse({ error: `Falha de rede na geração de imagem: ${err?.message || "erro desconhecido"}.` }, 503);
    }
  }

  if (isElevenlabsVerifyProxy) {
    return jsonResponse({ success: true, message: "Conexão com ElevenLabs simulada com sucesso." });
  }

  if (isMemorySyncSave) {
    try {
      const syncId = reqBody.syncId || `OSONE-LCL-${Math.floor(1000 + Math.random() * 9000)}`;
      localStorage.setItem(`osone_sync_fallback_${syncId}`, JSON.stringify(reqBody.payload));
      return jsonResponse({
        status: "success",
        syncId,
        message: "Perfil salvo localmente no navegador (sincronização estática ativa)."
      });
    } catch (err: any) {
      return jsonResponse({ status: "error", error: err?.message || "Falha ao salvar localmente." }, 500);
    }
  }

  if (isMemorySyncLoad) {
    try {
      const syncId = urlStr.split("/").pop() || "";
      const savedPayload = localStorage.getItem(`osone_sync_fallback_${syncId}`);
      if (!savedPayload) {
        return jsonResponse({ status: "error", error: `Sincronia local '${syncId}' não encontrada neste navegador.` }, 404);
      }
      return jsonResponse({ status: "success", payload: JSON.parse(savedPayload) });
    } catch (err: any) {
      return jsonResponse({ status: "error", error: err?.message || "Falha ao carregar a sincronia local." }, 500);
    }
  }

  return backendResponse || originalFetch(input, init);
};

try {
  Object.defineProperty(window, 'fetch', {
    value: customFetch,
    writable: true,
    configurable: true,
    enumerable: true
  });
} catch (e) {
  console.warn("Direct assignment of window.fetch failed, applying alternative fallback", e);
  try {
    (window as any).fetch = customFetch;
  } catch (_) {}
}

import App from './App.tsx';
import './index.css';

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: '#333', background: '#fff', fontSize: 16 }}>
          <h1 style={{ color: 'red' }}>Runtime Error</h1>
          <p>O aplicativo encontrou um erro e não pôde carregar.</p>
          <pre style={{ background: '#f5f5f5', padding: 10, borderRadius: 5, overflow: 'auto' }}>
            {this.state.error?.message}
          </pre>
          <details style={{ marginTop: 10 }}>
            <summary>Detalhes técnicos</summary>
            <pre style={{ fontSize: 12 }}>{this.state.error?.stack}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
