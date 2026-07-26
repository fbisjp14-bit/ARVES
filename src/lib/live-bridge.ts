import { GoogleGenAI } from "@google/genai";

export interface LiveBridgeSession {
  sendRealtimeInput: (input: any) => void;
  sendToolResponse: (payload: any) => void;
  close: () => void;
}

/**
 * Conexão universal para a API Gemini Live Multimodal
 * Suporta servidor Express local (via WebSocket proxy /api/live-ws) 
 * e ambientes Serverless / Vercel (via conexão direta client-side @google/genai).
 */
export async function connectToLiveBridge(options: {
  model: string;
  config: any;
  callbacks: {
    onopen?: () => void;
    onmessage?: (message: any) => void;
    onclose?: () => void;
    onerror?: (error: any) => void;
  };
  apiKey: string;
  accessToken?: string;
}): Promise<LiveBridgeSession> {
  // A chave manual é transmitida somente no primeiro frame do canal protegido.
  // Nunca é colocada na URL, no histórico do navegador ou nos logs do proxy.
  const effectiveApiKey = options.apiKey?.trim() || "";

  // 2. Detectar se está rodando em ambiente Serverless/Vercel
  const isVercelServerless = 
    typeof window !== "undefined" && 
    (window.location.hostname.includes("vercel.app") || 
     window.location.hostname.includes("vercel.dev") ||
     window.location.hostname.includes("now.sh") ||
     window.location.search.includes("serverless=true"));

  // Função interna para conexão direta do Gemini Live no cliente (Vercel / Fallback)
  const connectDirectlyToGeminiLive = async (key: string): Promise<LiveBridgeSession> => {
    console.log("ARVES G5 Client: Conectando diretamente ao Gemini Live API (Modo Serverless / Vercel)...");
    
    if (!key) {
      const err = new Error("Chave API do Gemini não fornecida. Insira sua chave nos ajustes do ARVES ou configure GEMINI_API_KEY no Vercel.");
      if (options.callbacks?.onerror) options.callbacks.onerror(err);
      throw err;
    }

    const ai = new GoogleGenAI({ apiKey: key, vertexai: false });
    const targetModel = options.model || "gemini-3.1-flash-live-preview";

    try {
      const directSession = await ai.live.connect({
        model: targetModel,
        config: options.config,
        callbacks: {
          onmessage: (data: any) => {
            const isGoAway = data?.goAway || 
                             data?.goaway || 
                             data?.serverContent?.goAway || 
                             data?.serverContent?.goaway;
            if (isGoAway) {
              console.warn("ARVES G5 Client: Sinal GoAway recebido da API Gemini Live.");
              try { directSession.close(); } catch (_) {}
              if (options.callbacks?.onclose) options.callbacks.onclose();
              return;
            }

            if (options.callbacks?.onmessage) {
              options.callbacks.onmessage(data);
            }
          },
          onclose: () => {
            console.log("ARVES G5 Client: Sessão Gemini Live direta encerrada.");
            if (options.callbacks?.onclose) options.callbacks.onclose();
          },
          onerror: (err: any) => {
            console.error("ARVES G5 Client: Erro na sessão Gemini Live direta:", err);
            if (options.callbacks?.onerror) options.callbacks.onerror(err);
          }
        }
      });

      console.log("ARVES G5 Client: Conexão Gemini Live direta estabelecida com sucesso!");
      if (options.callbacks?.onopen) {
        options.callbacks.onopen();
      }

      return {
        sendRealtimeInput: (input: any) => {
          try {
            if (directSession && typeof directSession.sendRealtimeInput === "function") {
              directSession.sendRealtimeInput(input);
            }
          } catch (e) {
            console.error("Erro ao enviar input realtime direto:", e);
          }
        },
        sendToolResponse: (payload: any) => {
          try {
            if (directSession && typeof directSession.sendToolResponse === "function") {
              directSession.sendToolResponse(payload);
            }
          } catch (e) {
            console.error("Erro ao enviar resposta de ferramenta direta:", e);
          }
        },
        close: () => {
          try {
            if (directSession && typeof directSession.close === "function") {
              directSession.close();
            }
          } catch (_) {}
        }
      };
    } catch (directErr: any) {
      console.error("ARVES G5 Client: Falha na conexão direta do Gemini Live:", directErr);
      if (options.callbacks?.onerror) {
        options.callbacks.onerror(directErr);
      }
      throw directErr;
    }
  };

  // Se estiver explicitamente no Vercel / Serverless, faz a conexão direta imediata sem tentar o WebSocket Proxy
  if (isVercelServerless) {
    return await connectDirectlyToGeminiLive(effectiveApiKey || "");
  }

  // Tenta conexão via WebSocket Proxy Local com Fallback Automático para Conexão Direta
  return new Promise<LiveBridgeSession>((resolve) => {
    let hasFallbackTriggered = false;

    const triggerFallback = async () => {
      if (hasFallbackTriggered) return;
      hasFallbackTriggered = true;
      console.warn("ARVES G5 Client: Proxy local indisponível. Ativando fallback para conexão direta com Gemini Live...");
      try {
        const session = await connectDirectlyToGeminiLive(effectiveApiKey || "");
        resolve(session);
      } catch (err) {
        resolve({
          sendRealtimeInput: () => {},
          sendToolResponse: () => {},
          close: () => {}
        });
      }
    };

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/live-ws`;

    console.log("ARVES G5 Client: Tentando conectar via proxy WebSocket local:", wsUrl);
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      triggerFallback();
      return;
    }

    const connectionTimeout = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        console.warn("ARVES G5 Client: Timeout ao conectar no proxy local. Usando fallback direto...");
        try { ws.close(); } catch (_) {}
        triggerFallback();
      }
    }, 2500);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      console.log("ARVES G5 Client: Canal WebSocket estabelecido via servidor local!");
      if (ws) {
        ws.send(JSON.stringify({
          type: "setup",
          model: options.model,
          config: options.config,
          clientApiKey: effectiveApiKey,
          accessToken: options.accessToken?.trim() || ""
        }));
      }

      if (options.callbacks?.onopen) {
        options.callbacks.onopen();
      }

      resolve({
        sendRealtimeInput: (input: any) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "realtime_input", input }));
          }
        },
        sendToolResponse: (payload: any) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "tool_response", payload }));
          }
        },
        close: () => {
          try { ws?.close(); } catch (e) {}
        }
      });
    };

    ws.onmessage = (event) => {
      try {
        const liveResponse = JSON.parse(event.data);
        if (liveResponse.type === "error") {
          console.error("ARVES G5 Client neural error via proxy:", liveResponse.error);
          if (options.callbacks?.onerror) {
            options.callbacks.onerror(new Error(liveResponse.error));
          }
          return;
        }

        const isGoAway = liveResponse?.goAway || 
                         liveResponse?.goaway || 
                         liveResponse?.serverContent?.goAway || 
                         liveResponse?.serverContent?.goaway;

        if (isGoAway) {
          console.warn("ARVES G5 Client: Sinal GoAway recebido. Encerrando sessão de voz.");
          try { ws?.close(); } catch (_) {}
          if (options.callbacks?.onclose) options.callbacks.onclose();
          return;
        }

        if (options.callbacks?.onmessage) {
          options.callbacks.onmessage(liveResponse);
        }
      } catch (e) {
        console.error("ARVES G5 Client: Erro ao decodificar mensagem do proxy websocket:", e);
      }
    };

    ws.onclose = () => {
      clearTimeout(connectionTimeout);
      if (!hasFallbackTriggered) {
        console.log("ARVES G5 Client: Conexão via proxy encerrada.");
        if (options.callbacks?.onclose) options.callbacks.onclose();
      }
    };

    ws.onerror = (err) => {
      clearTimeout(connectionTimeout);
      console.warn("ARVES G5 Client: Erro na conexão com o proxy local:", err);
      triggerFallback();
    };
  });
}
