import { normalizeExternalHttpUrl } from './externalUrl.ts';

const OPENAI_MODEL_IDS = [
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.4'
] as const;

export type OpenAIModelId = typeof OPENAI_MODEL_IDS[number];
export type OpenAIResearchMode = 'standard' | 'deep';

const JSON_SCHEMA_TYPES: Record<string, string> = {
  ARRAY: 'array',
  BOOLEAN: 'boolean',
  INTEGER: 'integer',
  NULL: 'null',
  NUMBER: 'number',
  OBJECT: 'object',
  STRING: 'string'
};

export const normalizeOpenAIKey = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

export const normalizeOpenAIModel = (value: unknown): OpenAIModelId => {
  return OPENAI_MODEL_IDS.includes(value as OpenAIModelId)
    ? value as OpenAIModelId
    : 'gpt-5.4-mini';
};

export const normalizeResearchMode = (value: unknown): OpenAIResearchMode => {
  return value === 'deep' ? 'deep' : 'standard';
};

const normalizeJsonSchema = (value: any): any => {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === 'type' && typeof child === 'string') {
        return [key, JSON_SCHEMA_TYPES[child.toUpperCase()] || child.toLowerCase()];
      }
      return [key, normalizeJsonSchema(child)];
    })
  );
};

const systemInstructionToText = (instruction: any): string => {
  if (typeof instruction === 'string') return instruction;
  if (Array.isArray(instruction?.parts)) {
    return instruction.parts
      .map((part: any) => typeof part?.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

const partToInputContent = (part: any): any | null => {
  if (typeof part?.text === 'string') {
    return { type: 'input_text', text: part.text };
  }

  const inlineData = part?.inlineData;
  if (inlineData?.data) {
    const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${inlineData.data}`;
    if (String(mimeType).toLowerCase().startsWith('image/')) {
      return {
        type: 'input_image',
        detail: 'high',
        image_url: dataUrl
      };
    }

    const fileExtensions: Record<string, string> = {
      'application/pdf': 'pdf',
      'application/json': 'json',
      'text/html': 'html',
      'text/markdown': 'md',
      'text/plain': 'txt'
    };
    const fileInput: any = {
      type: 'input_file',
      filename: `documento.${fileExtensions[mimeType] || 'bin'}`,
      file_data: dataUrl
    };
    if (mimeType === 'application/pdf') {
      fileInput.detail = 'low';
    }
    return fileInput;
  }

  return null;
};

export const geminiContentsToOpenAIInput = (contents: any): any[] => {
  const normalizedContents = typeof contents === 'string'
    ? [{ role: 'user', parts: [{ text: contents }] }]
    : Array.isArray(contents)
      ? contents
      : contents?.parts
        ? [contents]
        : [];

  const input: any[] = [];
  const pendingCalls = new Map<string, string[]>();
  let callIndex = 0;

  for (const content of normalizedContents) {
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const messageParts = parts
      .map(partToInputContent)
      .filter(Boolean);

    if (messageParts.length > 0) {
      const role = content?.role === 'model' || content?.role === 'assistant'
        ? 'assistant'
        : content?.role === 'system'
          ? 'system'
          : 'user';
      input.push({ role, content: messageParts });
    }

    for (const part of parts) {
      if (part?.functionCall?.name) {
        const name = String(part.functionCall.name);
        const callId = `osone_call_${callIndex++}`;
        const queue = pendingCalls.get(name) || [];
        queue.push(callId);
        pendingCalls.set(name, queue);
        input.push({
          type: 'function_call',
          call_id: callId,
          name,
          arguments: JSON.stringify(part.functionCall.args || {})
        });
      }

      if (part?.functionResponse?.name) {
        const name = String(part.functionResponse.name);
        const queue = pendingCalls.get(name) || [];
        const callId = queue.shift() || `osone_call_${callIndex++}`;
        pendingCalls.set(name, queue);
        input.push({
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(part.functionResponse.response ?? {})
        });
      }
    }
  }

  return input;
};

export const geminiToolsToOpenAITools = (
  geminiTools: any,
  researchMode: OpenAIResearchMode
): any[] => {
  const sourceTools = Array.isArray(geminiTools) ? geminiTools : [];
  const openAITools: any[] = [];
  let shouldEnableWebSearch = false;

  for (const sourceTool of sourceTools) {
    if (sourceTool?.googleSearch || sourceTool?.google_search) {
      shouldEnableWebSearch = true;
    }

    const declarations = Array.isArray(sourceTool?.functionDeclarations)
      ? sourceTool.functionDeclarations
      : [];

    for (const declaration of declarations) {
      if (!declaration?.name) continue;
      if (declaration.name === 'google_search') {
        shouldEnableWebSearch = true;
        continue;
      }

      openAITools.push({
        type: 'function',
        name: String(declaration.name),
        description: declaration.description
          ? String(declaration.description)
          : undefined,
        parameters: normalizeJsonSchema(
          declaration.parameters || { type: 'object', properties: {} }
        ),
        strict: false
      });
    }
  }

  if (shouldEnableWebSearch) {
    openAITools.unshift({
      type: 'web_search',
      search_context_size: researchMode === 'deep' ? 'high' : 'medium'
    });
  }

  return openAITools;
};

const safeJsonArguments = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export interface OpenAICitation {
  title: string;
  uri: string;
}

export const extractOpenAICitations = (response: any): OpenAICitation[] => {
  const citations = new Map<string, OpenAICitation>();
  const output = Array.isArray(response?.output) ? response.output : [];

  for (const item of output) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const content of item.content) {
        const annotations = Array.isArray(content?.annotations)
          ? content.annotations
          : [];
        for (const annotation of annotations) {
          if (annotation?.type === 'url_citation' && annotation.url) {
            const safeUrl = normalizeExternalHttpUrl(annotation.url);
            if (!safeUrl) continue;
            citations.set(safeUrl, {
              title: String(annotation.title || safeUrl).slice(0, 500),
              uri: safeUrl
            });
          }
        }
      }
    }

    if (item?.type === 'web_search_call') {
      const sources = Array.isArray(item?.action?.sources)
        ? item.action.sources
        : [];
      for (const source of sources) {
        const safeUrl = normalizeExternalHttpUrl(source?.url);
        if (safeUrl && !citations.has(safeUrl)) {
          citations.set(safeUrl, {
            title: safeUrl,
            uri: safeUrl
          });
        }
      }
    }
  }

  return Array.from(citations.values());
};

export const openAIResponseToGemini = (response: any): any => {
  const output = Array.isArray(response?.output) ? response.output : [];
  const functionCalls = output
    .filter((item: any) => item?.type === 'function_call' && item?.name)
    .map((item: any) => ({
      id: item.call_id || item.id,
      name: item.name,
      args: safeJsonArguments(item.arguments)
    }));

  const citations = extractOpenAICitations(response);
  let text = typeof response?.output_text === 'string'
    ? response.output_text.trim()
    : '';

  if (citations.length > 0) {
    const sourceBlock = citations
      .map((citation, index) => `${index + 1}. [${citation.title}](${citation.uri})`)
      .join('\n');
    text = `${text}${text ? '\n\n' : ''}### Fontes consultadas\n${sourceBlock}`;
  }

  const parts: any[] = [];
  if (text) parts.push({ text });
  for (const call of functionCalls) {
    parts.push({
      functionCall: {
        id: call.id,
        name: call.name,
        args: call.args
      }
    });
  }

  return {
    text,
    functionCalls,
    citations,
    provider: 'openai',
    model: response?.model,
    candidates: [{
      content: {
        role: 'model',
        parts
      },
      groundingMetadata: {
        groundingChunks: citations.map(citation => ({
          web: {
            title: citation.title,
            uri: citation.uri
          }
        }))
      }
    }]
  };
};

export const buildOpenAIResponseRequest = (body: any): any => {
  const config = body?.config || {};
  const researchMode = normalizeResearchMode(body?.openaiResearchMode);
  const tools = geminiToolsToOpenAITools(config.tools, researchMode);
  const isResearchRequest = tools.some(
    (tool: any) => tool.type === 'web_search'
  );
  const baseInstructions = systemInstructionToText(
    config.systemInstruction ?? body?.systemInstruction
  );
  const researchInstructions = isResearchRequest && researchMode === 'deep'
    ? '\n\nPESQUISA APROFUNDADA: quando a pergunta envolver fatos verificáveis, use a pesquisa na web, confronte fontes relevantes e atuais e sustente a resposta com citações.'
    : '';
  const inputSource =
    body?.contents ??
    body?.historyContents ??
    body?.prompt ??
    '';

  const request: any = {
    model: normalizeOpenAIModel(body?.openaiModel),
    input: geminiContentsToOpenAIInput(inputSource),
    instructions: `${baseInstructions}${researchInstructions}`.trim() || undefined,
    reasoning: {
      effort: isResearchRequest && researchMode === 'deep' ? 'high' : 'low'
    },
    store: false
  };

  if (tools.length > 0) {
    request.tools = tools;
    request.tool_choice = 'auto';
    request.parallel_tool_calls = true;
  }

  const maxOutputTokens =
    config.maxOutputTokens ??
    body?.maxOutputTokens;
  if (typeof maxOutputTokens === 'number' && maxOutputTokens > 0) {
    const minimumOutputTokens =
      isResearchRequest && researchMode === 'deep'
        ? 1_024
        : 16;
    request.max_output_tokens = Math.max(
      minimumOutputTokens,
      Math.min(maxOutputTokens, 32_000)
    );
  }

  if (
    config.responseMimeType === 'application/json' ||
    body?.responseMimeType === 'application/json'
  ) {
    request.text = {
      format: { type: 'json_object' }
    };
  } else {
    request.text = {
      verbosity:
        isResearchRequest && researchMode === 'deep'
          ? 'high'
          : 'medium'
    };
  }

  if (tools.some((tool: any) => tool.type === 'web_search')) {
    request.include = ['web_search_call.action.sources'];
  }

  return request;
};
