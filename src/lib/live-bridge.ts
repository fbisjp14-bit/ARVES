import { GoogleGenAI } from '@google/genai';

export interface LiveBridgeSession {
  sendRealtimeInput: (input: any) => void;
  sendToolResponse: (payload: any) => void;
  close: () => void;
}

/**
 * Opens Gemini Live using only the key explicitly supplied by the current
 * browser session. Server credentials are never returned to the browser and a
 * key is never placed in a URL or WebSocket query string.
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
}): Promise<LiveBridgeSession> {
  const apiKey = options.apiKey?.trim() || '';
  if (!apiKey) {
    const error = new Error(
      'Chave Gemini ausente. O modo Live exige uma chave informada nesta sessão.'
    );
    options.callbacks?.onerror?.(error);
    throw error;
  }

  const ai = new GoogleGenAI({ apiKey, vertexai: false });
  const targetModel = options.model || 'gemini-3.1-flash-live-preview';

  try {
    let closed = false;
    let directSession: any;
    directSession = await ai.live.connect({
      model: targetModel,
      config: options.config,
      callbacks: {
        onmessage: (data: any) => {
          const isGoAway =
            data?.goAway ||
            data?.goaway ||
            data?.serverContent?.goAway ||
            data?.serverContent?.goaway;
          if (isGoAway) {
            if (!closed) {
              closed = true;
              try { directSession.close(); } catch {}
              options.callbacks?.onclose?.();
            }
            return;
          }
          options.callbacks?.onmessage?.(data);
        },
        onclose: () => {
          if (closed) return;
          closed = true;
          options.callbacks?.onclose?.();
        },
        onerror: (error: any) => {
          options.callbacks?.onerror?.(error);
        }
      }
    });

    options.callbacks?.onopen?.();
    return {
      sendRealtimeInput: (input: any) => {
        if (!closed) directSession.sendRealtimeInput(input);
      },
      sendToolResponse: (payload: any) => {
        if (!closed) directSession.sendToolResponse(payload);
      },
      close: () => {
        if (closed) return;
        closed = true;
        try { directSession.close(); } catch {}
      }
    };
  } catch (error) {
    options.callbacks?.onerror?.(error);
    throw error;
  }
}
