import React, { StrictMode, Component, ReactNode, ErrorInfo } from 'react';
import {createRoot} from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';
import { enrichGeminiResponse, normalizeGeminiApiKey, verifyGeminiApiKey } from './lib/geminiApi';
import { isStaticProductionHost, shouldUseApiFallback } from './lib/apiFallback';
import { withOsoneClientId } from './lib/clientIdentity';
import { redactSecrets } from './lib/redaction';

// Safe global process mockup for client-side static environments (e.g. Vercel)
if (typeof window !== 'undefined') {
  const g = window as any;
  g.process = g.process || {};
  g.process.env = g.process.env || {};
  if (typeof g.process.env.GEMINI_API_KEY === 'undefined') {
    g.process.env.GEMINI_API_KEY = '';
  }
}

// Migração única: remove seleções OpenAI antigas e fixa o modelo solicitado.
try {
  const migrationKey = 'osone_openai_sol_v1';
  if (!localStorage.getItem(migrationKey)) {
    for (let index = 0; index < localStorage.length; index++) {
      const storageKey = localStorage.key(index);
      if (
        !storageKey ||
        (storageKey !== 'osone_api_keys' &&
          storageKey !== 'osone_guest_api_keys' &&
          !/^osone_user_.+_api_keys$/.test(storageKey))
      ) {
        continue;
      }
      const savedKeys = localStorage.getItem(storageKey);
      if (!savedKeys) continue;
      const parsedKeys = JSON.parse(savedKeys);
      localStorage.setItem(storageKey, JSON.stringify({
        ...parsedKeys,
        aiProvider: 'gemini',
        openaiModel: 'gpt-5.6-sol',
        openaiFallbackEnabled:
          parsedKeys.openaiFallbackEnabled !== false
      }));
    }
    localStorage.setItem(migrationKey, '1');
  }
} catch (_) {}

// Migre uma única vez a configuração global antiga para o perfil que estava
// ativo. Perfis criados depois disso começam sem herdar credenciais.
try {
  const migrationKey = 'osone_scoped_api_keys_v1';
  if (!localStorage.getItem(migrationKey)) {
    const legacyKeys = localStorage.getItem('osone_api_keys');
    const savedUser = localStorage.getItem('osone_last_active_user');
    let scopedKey = 'osone_guest_api_keys';
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      const uid = typeof parsedUser?.uid === 'string'
        ? parsedUser.uid.trim()
        : '';
      if (/^[A-Za-z0-9:_-]{4,128}$/.test(uid)) {
        scopedKey = `osone_user_${uid}_api_keys`;
      }
    }
    if (legacyKeys && !localStorage.getItem(scopedKey)) {
      localStorage.setItem(scopedKey, legacyKeys);
    }
    localStorage.setItem(migrationKey, '1');
  }

  const savedUser = localStorage.getItem('osone_last_active_user');
  let scopedKey = 'osone_guest_api_keys';
  if (savedUser) {
    const parsedUser = JSON.parse(savedUser);
    const uid = typeof parsedUser?.uid === 'string'
      ? parsedUser.uid.trim()
      : '';
    if (/^[A-Za-z0-9:_-]{4,128}$/.test(uid)) {
      scopedKey = `osone_user_${uid}_api_keys`;
    }
  }
  const scopedKeys = localStorage.getItem(scopedKey);
  if (scopedKeys) {
    sessionStorage.setItem('osone_active_api_keys_v1', scopedKeys);
  }
  localStorage.removeItem('osone_api_keys');
} catch (_) {}

// Versões antigas pediam um cookie de sessão do TikTok para um conector que
// não funciona em Functions. Remova qualquer resíduo sensível já persistido.
try {
  localStorage.removeItem('osone_tiktok_session_id');
  localStorage.removeItem('osone_tiktok_target_idc');
} catch (_) {}

// --- Vercel/Static Direct Client-Side Fallback for Gemini and Services ---
const originalFetch = window.fetch.bind(window);
const backendFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => originalFetch(input, withOsoneClientId(init));

const safeClientApiError = (error: unknown, activeSecret = ''): string => {
  const rawMessage =
    error instanceof Error
      ? error.message
      : 'A API não respondeu à solicitação.';
  return (
    redactSecrets(rawMessage, [activeSecret], 500) ||
    'A API não respondeu à solicitação.'
  );
};

const customFetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (urlStr.includes("/api/")) {
    const isGeminiContentProxy = urlStr.includes("/api/gemini/generateContent") || urlStr.includes("/api/chat-intel");
    const isGeminiGenerateProxy = urlStr.includes("/api/generate");
    const isGeminiImageProxy = urlStr.includes("/api/gemini/generateImages");
    const isGeminiVerifyProxy = urlStr.includes("/api/gemini/verify");
    const isLensProxy = urlStr.includes("/api/lens/query");
    const isWhatsAppAssistant = urlStr.includes("/api/whatsapp/simulate-incoming");
    const isProviderExecution =
      isGeminiContentProxy ||
      isGeminiGenerateProxy ||
      isGeminiImageProxy ||
      isLensProxy ||
      isWhatsAppAssistant;

    let storedApiKeys: any = {};
    let parsedRequestBody: any = {};
    try {
      const stored = sessionStorage.getItem("osone_active_api_keys_v1");
      storedApiKeys = stored ? JSON.parse(stored) : {};
    } catch (_) {}
    if (init?.body && typeof init.body === "string") {
      try {
        parsedRequestBody = JSON.parse(init.body);
      } catch (_) {}
    }

    let providerInit = init;
    if (isProviderExecution) {
      const headers = new Headers(init?.headers);
      headers.set("Content-Type", "application/json");
      providerInit = {
        ...init,
        method: init?.method || "POST",
        headers,
        body: JSON.stringify({
          ...parsedRequestBody,
          clientApiKey:
            parsedRequestBody.clientApiKey ||
            parsedRequestBody.geminiApiKey ||
            storedApiKeys.gemini ||
            "",
          openaiApiKey: storedApiKeys.openaiApiKey || "",
          openaiModel: "gpt-5.6-sol",
          openaiResearchMode: storedApiKeys.openaiResearchMode || "standard",
          openaiImageQuality: storedApiKeys.openaiImageQuality || "high",
          openaiFallbackEnabled:
            storedApiKeys.openaiFallbackEnabled !== false
        })
      };
    }

    if (
      isGeminiContentProxy ||
      isGeminiGenerateProxy ||
      isGeminiImageProxy ||
      isGeminiVerifyProxy
    ) {
      const isStaticHost = isStaticProductionHost(
        window.location.hostname,
        import.meta.env.PROD
      );
      
      // Try the real API function first. If Vercel Functions are unavailable, the same
      // client-side SDK flow that made the original Copilot reliable takes over.
      let useFallback = false;
      let response: Response | null = null;

      if (!useFallback) {
        try {
          response = await backendFetch(input, providerInit);
          if (isStaticHost && shouldUseApiFallback(response, urlStr)) {
            useFallback = true;
          } else {
            return response;
          }
        } catch (e) {
          useFallback = true;
        }
      }

      if (useFallback) {
        let clientApiKey = "";
        let geminiModel = "gemini-3.5-flash";
        try {
          const stored = sessionStorage.getItem("osone_active_api_keys_v1");
          if (stored) {
            const parsed = JSON.parse(stored);
            clientApiKey = normalizeGeminiApiKey(parsed.gemini);
            geminiModel = parsed.geminiModel || "gemini-3.5-flash";
          }
        } catch (_) {}

        let reqBody: any = {};
        if (providerInit && providerInit.body) {
          try {
            reqBody = JSON.parse(providerInit.body as string);
            if (!clientApiKey) {
              clientApiKey = normalizeGeminiApiKey(reqBody.clientApiKey || reqBody.geminiApiKey);
            }
          } catch (_) {}
        }

        if (clientApiKey) {
          console.log("[Vercel-OSONE Fallback] Intercepting fetch and making direct client-side call to Google Gemini API...");
          
          try {
            if (isGeminiVerifyProxy) {
              const result = await verifyGeminiApiKey(
                reqBody.geminiApiKey || clientApiKey,
                originalFetch
              );
              return new Response(JSON.stringify(result), {
                status: result.success ? 200 : 400,
                headers: { "Content-Type": "application/json" }
              });
            }

            if (isGeminiContentProxy) {
              const selectedModel = reqBody.model || geminiModel;
              const contents = reqBody.contents || (reqBody.historyContents ? reqBody.historyContents : []);
              const config = {
                ...(reqBody.config || {}),
                ...(reqBody.systemInstruction && !reqBody.config?.systemInstruction
                  ? { systemInstruction: reqBody.systemInstruction }
                  : {})
              };
              const ai = new GoogleGenAI({ apiKey: clientApiKey });
              const geminiData = await ai.models.generateContent({
                model: selectedModel,
                contents,
                config
              });

              return new Response(JSON.stringify(enrichGeminiResponse(geminiData)), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }

            if (isGeminiGenerateProxy) {
              const selectedModel = reqBody.model || geminiModel;
              const promptText = reqBody.prompt || "";
              const systemInstruction = reqBody.systemInstruction || "";
              const ai = new GoogleGenAI({ apiKey: clientApiKey });
              const geminiData = await ai.models.generateContent({
                model: selectedModel,
                contents: promptText,
                config: {
                  ...(systemInstruction ? { systemInstruction } : {}),
                  ...(reqBody.responseMimeType ? { responseMimeType: reqBody.responseMimeType } : {})
                }
              });
              return new Response(JSON.stringify(enrichGeminiResponse(geminiData)), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }

            if (isGeminiImageProxy) {
              const selectedModel = reqBody.model || "gemini-3.1-flash-image";
              const promptStr = reqBody.prompt || "";
              const aspectRatio = reqBody.config?.aspectRatio || "1:1";
              const imageSize = reqBody.config?.imageSize || "1K";
              const ai = new GoogleGenAI({ apiKey: clientApiKey });
              const imageResult = await ai.models.generateContent({
                model: selectedModel,
                contents: { parts: [{ text: promptStr }] },
                config: {
                  imageConfig: {
                    aspectRatio,
                    imageSize
                  }
                }
              });

              let imageBytes = "";
              const parts = imageResult.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if (part.inlineData?.data) {
                  imageBytes = part.inlineData.data;
                  break;
                }
              }

              if (!imageBytes) {
                throw new Error("A API não retornou dados de imagem.");
              }

              return new Response(JSON.stringify({
                generatedImages: [{ image: { imageBytes } }]
              }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }

          } catch (err: any) {
            const safeMessage = safeClientApiError(err, clientApiKey);
            console.warn("[Vercel-OSONE Fallback] A chamada direta ao Gemini falhou.");
            return new Response(JSON.stringify({ error: `Falha do Gemini: ${safeMessage}` }), {
              status: 500,
              headers: { "Content-Type": "application/json" }
            });
          }
        } else {
          if (isGeminiContentProxy || isGeminiGenerateProxy || isGeminiVerifyProxy) {
            return new Response(JSON.stringify({ 
              error: "Por favor, configure sua própria Chave API do Gemini nas configurações do OSONE (ícone de engrenagem) ou na aba de Ajustes. Como você está rodando no Vercel (modo estático), o uso do proxy do servidor local não está disponível e é necessário fornecer uma Chave API válida." 
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }
        }

      }

      if (response) return response;
    }

    if (isProviderExecution) {
      return backendFetch(input, providerInit);
    }
  }

  return urlStr.includes('/api/')
    ? backendFetch(input, init)
    : originalFetch(input, init);
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
