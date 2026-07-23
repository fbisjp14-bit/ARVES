const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

export type GeminiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export const normalizeGeminiApiKey = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = await response.clone().json();
    return body?.error?.message || body?.message || `HTTP ${response.status}`;
  } catch {
    try {
      return (await response.clone().text()) || `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }
};

/**
 * Sends a Gemini REST request using the authentication format required by
 * current Google AI Studio authorization keys. Never converts an API key into
 * an OAuth Bearer token.
 */
export const geminiApiFetch = async (
  path: string,
  apiKey: string,
  init: RequestInit = {},
  fetcher: GeminiFetch = fetch
): Promise<Response> => {
  const normalizedKey = normalizeGeminiApiKey(apiKey);
  if (!normalizedKey) {
    throw new Error('A chave API do Gemini não foi informada.');
  }

  const headers = new Headers(init.headers);
  headers.delete('Authorization');
  headers.set('x-goog-api-key', normalizedKey);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return fetcher(`${GEMINI_API_ROOT}${normalizedPath}`, {
    ...init,
    headers
  });
};

/**
 * Validates credentials without consuming a text generation request. This
 * avoids false negatives caused by generation quota (HTTP 429).
 */
export const verifyGeminiApiKey = async (
  apiKey: string,
  fetcher: GeminiFetch = fetch
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await geminiApiFetch(
      '/models?pageSize=1',
      apiKey,
      { method: 'GET' },
      fetcher
    );

    if (!response.ok) {
      const message = await readErrorMessage(response);
      return {
        success: false,
        message: `Falha no Handshake: ${message}`
      };
    }

    return {
      success: true,
      message: 'Conexão bem-sucedida! Chave Gemini reconhecida e pronta para uso.'
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'Não foi possível alcançar a API do Gemini.'
    };
  }
};

export const enrichGeminiResponse = (response: any): any => {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .filter((part: any) => typeof part?.text === 'string')
    .map((part: any) => part.text)
    .join('');
  const functionCalls = parts
    .filter((part: any) => part?.functionCall)
    .map((part: any) => part.functionCall);

  return {
    ...response,
    text: response?.text ?? text,
    ...(functionCalls.length > 0 ? { functionCalls } : {})
  };
};

