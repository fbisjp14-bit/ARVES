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

// --- Vercel/Static Direct Client-Side Fallback for Gemini and Services ---
const originalFetch = window.fetch.bind(window);

const normalizeGeminiApiKey = (value: unknown): string => {
  return String(value || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
};

const parseGoogleApiError = async (response: Response): Promise<{ message: string; status: string; code: number }> => {
  let payload: any = null;
  try {
    payload = await response.clone().json();
  } catch (_) {
    try {
      const raw = await response.clone().text();
      payload = raw ? { error: { message: raw } } : null;
    } catch (_) {}
  }

  const apiError = payload?.error || payload || {};
  const status = String(apiError.status || "");
  const code = Number(apiError.code || response.status || 0);
  const rawMessage = String(apiError.message || "Falha de comunicação com a API do Gemini.");

  if (code === 429 || status === "RESOURCE_EXHAUSTED") {
    const retryMatch = rawMessage.match(/retry\s+in\s+([0-9.]+)s/i);
    const retryText = retryMatch ? ` Aguarde aproximadamente ${Math.ceil(Number(retryMatch[1]))} segundos.` : " Aguarde um pouco e tente novamente.";
    return {
      code,
      status,
      message: `A chave foi reconhecida, mas a cota ou o limite temporário da API foi atingido.${retryText}`
    };
  }

  if (code === 400 && /api[_ ]?key|invalid|malformed/i.test(rawMessage)) {
    return { code, status, message: "A chave informada é inválida. Copie novamente a chave completa no Google AI Studio." };
  }

  if (code === 403 || status === "PERMISSION_DENIED") {
    return { code, status, message: "A chave existe, mas não tem permissão para usar a API Gemini neste projeto." };
  }

  if (code === 404 || status === "NOT_FOUND") {
    return { code, status, message: "O modelo selecionado não está disponível para esta chave. Selecione outro modelo nos ajustes." };
  }

  return { code, status, message: rawMessage.slice(0, 500) };
};

const buildGeminiModelCandidates = (requested: string): string[] => {
  return Array.from(new Set([
    requested || "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash"
  ].filter(Boolean)));
};

const directGeminiGenerateContent = async (
  apiKey: string,
  requestedModel: string,
  payload: any
): Promise<{ response: Response; model: string }> => {
  const cleanKey = normalizeGeminiApiKey(apiKey);
  let lastResponse: Response | null = null;

  for (const model of buildGeminiModelCandidates(requestedModel)) {
    const response = await originalFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": cleanKey
        },
        body: JSON.stringify(payload)
      }
    );

    if (response.ok) return { response, model };
    lastResponse = response;

    const parsed = await parseGoogleApiError(response);
    const canTryAnotherModel = parsed.code === 404 || parsed.code === 429 || parsed.status === "NOT_FOUND" || parsed.status === "RESOURCE_EXHAUSTED";
    if (!canTryAnotherModel) break;
  }

  return { response: lastResponse as Response, model: requestedModel };
};

const customFetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (urlStr.includes("/api/")) {
    const isGeminiContentProxy = urlStr.includes("/api/gemini/generateContent") || urlStr.includes("/api/chat-intel");
    const isGeminiGenerateProxy = urlStr.includes("/api/generate");
    const isGeminiImageProxy = urlStr.includes("/api/gemini/generateImages");
    const isGeminiVerifyProxy = urlStr.includes("/api/gemini/verify");
    const isElevenlabsVerifyProxy = urlStr.includes("/api/elevenlabs/verify");
    const isMemorySyncSave = urlStr.includes("/api/memory-sync/save");
    const isMemorySyncLoad = urlStr.includes("/api/memory-sync/load/");

    if (
      isGeminiContentProxy ||
      isGeminiGenerateProxy ||
      isGeminiImageProxy ||
      isGeminiVerifyProxy ||
      isElevenlabsVerifyProxy ||
      isMemorySyncSave ||
      isMemorySyncLoad
    ) {
      const hasBackendServer = window.location.hostname.includes(".run.app") || 
                               window.location.hostname.includes("localhost") || 
                               window.location.hostname.includes("127.0.0.1") ||
                               window.location.hostname.includes("webcontainer-api.io");

      const isVercel = !hasBackendServer && (
        window.location.hostname.includes("vercel.app") || 
        window.location.hostname.includes("github.io") || 
        window.location.hostname.includes("netlify.app")
      );
      
      let useFallback = isVercel;
      let response: Response | null = null;

      if (!isVercel) {
        try {
          response = await originalFetch(input, init);
          const contentType = response?.headers?.get("content-type") || "";
          if (
            response.status === 404 || 
            response.status === 502 || 
            response.status === 504 ||
            (contentType.includes("text/html") && urlStr.includes("/api/"))
          ) {
            useFallback = true;
          }
        } catch (e) {
          useFallback = true;
        }
      }

      if (useFallback) {
        let clientApiKey = "";
        let geminiModel = "gemini-3.5-flash";
        try {
          const stored = localStorage.getItem("osone_api_keys");
          if (stored) {
            const parsed = JSON.parse(stored);
            clientApiKey = normalizeGeminiApiKey(parsed.gemini || "");
            geminiModel = parsed.geminiModel || "gemini-3.5-flash";
          }
        } catch (_) {}

        let reqBody: any = {};
        if (init && init.body) {
          try {
            reqBody = JSON.parse(init.body as string);
            const requestApiKey = normalizeGeminiApiKey(reqBody.clientApiKey || reqBody.geminiApiKey || "");
            if (requestApiKey) {
              clientApiKey = requestApiKey;
            }
          } catch (_) {}
        }

        clientApiKey = normalizeGeminiApiKey(clientApiKey);

        if (clientApiKey) {
          console.log("[Vercel-OSONE Fallback] Intercepting fetch and making direct client-side call to Google Gemini API...");
          
          try {
            if (isGeminiVerifyProxy) {
              const verifyApiKey = normalizeGeminiApiKey(reqBody.geminiApiKey || clientApiKey);
              if (!verifyApiKey) {
                return new Response(JSON.stringify({ success: false, message: "Informe uma chave API Gemini válida." }), {
                  status: 400,
                  headers: { "Content-Type": "application/json" }
                });
              }

              // Valida a chave listando os modelos. Isso não consome uma geração e evita
              // que o botão de teste esgote a pequena cota gratuita por minuto.
              const directRes = await originalFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
                method: "GET",
                headers: { "x-goog-api-key": verifyApiKey }
              });

              if (directRes.ok) {
                const current = (() => {
                  try {
                    return JSON.parse(localStorage.getItem("osone_api_keys") || "{}");
                  } catch (_) {
                    return {};
                  }
                })();
                localStorage.setItem("osone_api_keys", JSON.stringify({ ...current, gemini: verifyApiKey }));
                return new Response(JSON.stringify({
                  success: true,
                  message: "Chave válida e salva. Conexão com a API Gemini confirmada sem consumir a cota de geração."
                }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" }
                });
              }

              const parsedError = await parseGoogleApiError(directRes);
              if (parsedError.code === 429 || parsedError.status === "RESOURCE_EXHAUSTED") {
                const current = (() => {
                  try {
                    return JSON.parse(localStorage.getItem("osone_api_keys") || "{}");
                  } catch (_) {
                    return {};
                  }
                })();
                localStorage.setItem("osone_api_keys", JSON.stringify({ ...current, gemini: verifyApiKey }));
                return new Response(JSON.stringify({
                  success: true,
                  warning: true,
                  message: `${parsedError.message} A chave foi salva e será usada automaticamente quando a cota for liberada.`
                }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" }
                });
              }

              return new Response(JSON.stringify({ success: false, message: parsedError.message }), {
                status: directRes.status || 400,
                headers: { "Content-Type": "application/json" }
              });
            }

            if (isGeminiContentProxy) {
              const selectedModel = reqBody.model || geminiModel;
              const contents = reqBody.contents || (reqBody.historyContents ? reqBody.historyContents : []);
              const systemInstruction = reqBody.config?.systemInstruction || reqBody.systemInstruction || "";
              
              let sysInstructionParts = undefined;
              if (systemInstruction) {
                sysInstructionParts = {
                  parts: [{ text: systemInstruction }]
                };
              }

              const generationConfig: any = {};
              if (reqBody.config?.temperature !== undefined) generationConfig.temperature = reqBody.config.temperature;
              if (reqBody.config?.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = reqBody.config.maxOutputTokens;
              if (reqBody.config?.responseMimeType !== undefined) generationConfig.responseMimeType = reqBody.config.responseMimeType;
              if (reqBody.responseMimeType !== undefined) generationConfig.responseMimeType = reqBody.responseMimeType;

              const payload: any = { contents };
              if (sysInstructionParts) payload.systemInstruction = sysInstructionParts;
              if (Object.keys(generationConfig).length > 0) payload.generationConfig = generationConfig;

              const { response: directRes, model: usedModel } = await directGeminiGenerateContent(clientApiKey, selectedModel, payload);

              if (!directRes.ok) {
                const parsedError = await parseGoogleApiError(directRes);
                return new Response(JSON.stringify({ error: parsedError.message, code: parsedError.code, status: parsedError.status }), {
                  status: directRes.status,
                  headers: { "Content-Type": "application/json" }
                });
              }

              const geminiData = await directRes.json();
              const textResult = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
              
              const formattedOutput = {
                text: textResult,
                candidates: geminiData.candidates,
                model: usedModel
              };

              return new Response(JSON.stringify(formattedOutput), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }

            if (isGeminiGenerateProxy) {
              const selectedModel = reqBody.model || geminiModel;
              const promptText = reqBody.prompt || "";
              const systemInstruction = reqBody.systemInstruction || "";

              let sysInstructionParts = undefined;
              if (systemInstruction) {
                sysInstructionParts = {
                  parts: [{ text: systemInstruction }]
                };
              }

              const generationConfig: any = {};
              if (reqBody.responseMimeType !== undefined) generationConfig.responseMimeType = reqBody.responseMimeType;

              const contents = [{
                role: "user",
                parts: [{ text: promptText }]
              }];

              const payload: any = { contents };
              if (sysInstructionParts) payload.systemInstruction = sysInstructionParts;
              if (Object.keys(generationConfig).length > 0) payload.generationConfig = generationConfig;

              const { response: directRes, model: usedModel } = await directGeminiGenerateContent(clientApiKey, selectedModel, payload);

              if (!directRes.ok) {
                const parsedError = await parseGoogleApiError(directRes);
                return new Response(JSON.stringify({ error: parsedError.message, code: parsedError.code, status: parsedError.status }), {
                  status: directRes.status,
                  headers: { "Content-Type": "application/json" }
                });
              }

              const geminiData = await directRes.json();
              const textResult = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

              return new Response(JSON.stringify({ text: textResult, model: usedModel }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }

            if (isGeminiImageProxy) {
              const selectedModel = reqBody.model || "gemini-3.1-flash-image";
              const promptStr = String(reqBody.prompt || "").trim();
              const aspectRatio = reqBody.config?.aspectRatio || "1:1";
              const imageSize = reqBody.config?.imageSize || "1K";

              if (!promptStr) {
                return new Response(JSON.stringify({ error: "Descreva a imagem que deseja gerar." }), {
                  status: 400,
                  headers: { "Content-Type": "application/json" }
                });
              }

              // Os modelos Gemini de imagem usam generateContent, não generateImages.
              const payload = {
                contents: [{
                  role: "user",
                  parts: [{ text: promptStr }]
                }],
                generationConfig: {
                  responseModalities: ["IMAGE"],
                  responseFormat: {
                    image: {
                      aspectRatio,
                      imageSize
                    }
                  }
                }
              };

              const directRes = await originalFetch(
                `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(selectedModel)}:generateContent`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": normalizeGeminiApiKey(clientApiKey)
                  },
                  body: JSON.stringify(payload)
                }
              );

              if (!directRes.ok) {
                const parsedError = await parseGoogleApiError(directRes);
                return new Response(JSON.stringify({ error: parsedError.message, code: parsedError.code, status: parsedError.status }), {
                  status: directRes.status,
                  headers: { "Content-Type": "application/json" }
                });
              }

              const imageData = await directRes.json();
              const parts = imageData?.candidates?.[0]?.content?.parts || [];
              const imagePart = parts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data);
              const inlineData = imagePart?.inlineData || imagePart?.inline_data;

              if (!inlineData?.data) {
                return new Response(JSON.stringify({ error: "A API respondeu, mas não retornou os dados da imagem." }), {
                  status: 502,
                  headers: { "Content-Type": "application/json" }
                });
              }

              return new Response(JSON.stringify({
                generatedImages: [{
                  image: {
                    imageBytes: inlineData.data,
                    mimeType: inlineData.mimeType || inlineData.mime_type || "image/png"
                  }
                }]
              }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }


          } catch (err: any) {
            console.error("[Vercel-OSONE Fallback] Error in client-side direct fallback:", err);
            return new Response(JSON.stringify({ error: `Direct Gemini error: ${err.message}` }), {
              status: 500,
              headers: { "Content-Type": "application/json" }
            });
          }
        } else {
          if (isGeminiContentProxy || isGeminiGenerateProxy || isGeminiImageProxy || isGeminiVerifyProxy) {
            return new Response(JSON.stringify({ 
              error: "Por favor, configure sua própria Chave API do Gemini nas configurações do OSONE (ícone de engrenagem) ou na aba de Ajustes. Como você está rodando no Vercel (modo estático), o uso do proxy do servidor local não está disponível e é necessário fornecer uma Chave API válida." 
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }
        }

        if (isElevenlabsVerifyProxy) {
          return new Response(JSON.stringify({
            success: true,
            message: "Conexão com ElevenLabs simulada com sucesso."
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        if (isMemorySyncSave) {
          try {
            const syncId = reqBody.syncId || `OSONE-LCL-${Math.floor(1000 + Math.random() * 9000)}`;
            const payloadStr = JSON.stringify(reqBody.payload);
            localStorage.setItem(`osone_sync_fallback_${syncId}`, payloadStr);
            return new Response(JSON.stringify({
              status: "success",
              syncId: syncId,
              message: "Perfil salvo localmente no navegador (Sincronização estática ativa)."
            }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          } catch (err: any) {
            return new Response(JSON.stringify({ status: "error", error: err.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" }
            });
          }
        }

        if (isMemorySyncLoad) {
          try {
            const syncId = urlStr.split("/").pop() || "";
            const savedPayload = localStorage.getItem(`osone_sync_fallback_${syncId}`);
            if (savedPayload) {
              return new Response(JSON.stringify({
                status: "success",
                payload: JSON.parse(savedPayload)
              }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            } else {
              return new Response(JSON.stringify({
                status: "error",
                error: `Sincronia local '${syncId}' não encontrada neste navegador. No Vercel estático, os backups ficam salvos no seu localStorage atual.`
              }), {
                status: 404,
                headers: { "Content-Type": "application/json" }
              });
            }
          } catch (err: any) {
            return new Response(JSON.stringify({ status: "error", error: err.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" }
            });
          }
        }
      }

      if (response) return response;
    }
  }

  return originalFetch(input, init);
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
