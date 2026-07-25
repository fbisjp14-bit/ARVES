import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenAIResponseRequest,
  geminiContentsToOpenAIInput,
  normalizeOpenAIModel,
  normalizeResearchMode,
  openAIResponseToGemini
} from '../src/lib/openaiCompatibility.ts';

test('usa o perfil econômico quando o modelo e a pesquisa não forem informados', () => {
  assert.equal(normalizeOpenAIModel(undefined), 'gpt-5.4-mini');
  assert.equal(normalizeResearchMode(undefined), 'standard');

  const request = buildOpenAIResponseRequest({
    contents: [{ role: 'user', parts: [{ text: 'Resuma este texto.' }] }]
  });

  assert.equal(request.model, 'gpt-5.4-mini');
  assert.equal(request.reasoning.effort, 'low');
  assert.equal(request.tools, undefined);
});

test('converte histórico e ferramentas Gemini para a Responses API', () => {
  const request = buildOpenAIResponseRequest({
    openaiModel: 'gpt-5.4',
    openaiResearchMode: 'deep',
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Pesquise o assunto e faça um resumo.' }]
      }
    ],
    config: {
      systemInstruction: 'Você é o OSONE.',
      tools: [{
        functionDeclarations: [
          {
            name: 'google_search',
            parameters: {
              type: 'OBJECT',
              properties: {
                query: { type: 'STRING' }
              }
            }
          },
          {
            name: 'create_file',
            parameters: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' }
              },
              required: ['name']
            }
          }
        ]
      }]
    }
  });

  assert.equal(request.model, 'gpt-5.4');
  assert.equal(request.input[0].role, 'user');
  assert.equal(request.input[0].content[0].text, 'Pesquise o assunto e faça um resumo.');
  assert.match(request.instructions, /PESQUISA APROFUNDADA/);
  assert.equal(request.tools[0].type, 'web_search');
  assert.equal(request.tools[0].search_context_size, 'high');
  assert.equal(request.tools[0].return_token_budget, undefined);
  assert.equal(request.reasoning.effort, 'high');
  const createFileTool = request.tools.find((tool: any) => tool.name === 'create_file');
  assert.equal(createFileTool.parameters.type, 'object');
  assert.equal(createFileTool.parameters.properties.name.type, 'string');
  assert.equal(
    request.tools.some((tool: any) => tool.name === 'google_search'),
    false
  );
});

test('mantém chamadas e retornos de ferramentas no histórico convertido', () => {
  const input = geminiContentsToOpenAIInput([
    {
      role: 'model',
      parts: [{
        functionCall: {
          name: 'read_web_page',
          args: { url: 'https://example.com' }
        }
      }]
    },
    {
      role: 'tool',
      parts: [{
        functionResponse: {
          name: 'read_web_page',
          response: { result: 'Conteúdo encontrado.' }
        }
      }]
    }
  ]);

  assert.equal(input[0].type, 'function_call');
  assert.equal(input[1].type, 'function_call_output');
  assert.equal(input[0].call_id, input[1].call_id);
});

test('converte PDF em input_file e mantém imagens como input_image', () => {
  const input = geminiContentsToOpenAIInput([{
    role: 'user',
    parts: [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: 'JVBERi0xLjQ='
        }
      },
      {
        inlineData: {
          mimeType: 'image/png',
          data: 'aW1hZ2Vt'
        }
      }
    ]
  }]);

  assert.equal(input[0].content[0].type, 'input_file');
  assert.equal(input[0].content[0].filename, 'documento.pdf');
  assert.equal(input[0].content[0].detail, 'low');
  assert.match(input[0].content[0].file_data, /^data:application\/pdf;base64,/);
  assert.equal(input[0].content[1].type, 'input_image');
  assert.match(input[0].content[1].image_url, /^data:image\/png;base64,/);
});

test('traduz texto, fontes e function calls de volta para o formato do OSONE', () => {
  const compatible = openAIResponseToGemini({
    model: 'gpt-5.4-mini',
    output_text: 'Resposta verificada.',
    output: [
      {
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'Resposta verificada.',
          annotations: [{
            type: 'url_citation',
            title: 'Fonte oficial',
            url: 'https://example.com/source',
            start_index: 0,
            end_index: 10
          }]
        }]
      },
      {
        type: 'function_call',
        call_id: 'call_123',
        name: 'create_file',
        arguments: '{"name":"relatorio.md"}'
      }
    ]
  });

  assert.match(compatible.text, /Resposta verificada/);
  assert.match(compatible.text, /Fonte oficial/);
  assert.equal(compatible.functionCalls[0].name, 'create_file');
  assert.deepEqual(compatible.functionCalls[0].args, {
    name: 'relatorio.md'
  });
  assert.equal(
    compatible.candidates[0].groundingMetadata.groundingChunks[0].web.uri,
    'https://example.com/source'
  );
});

test('descarta citações com protocolos perigosos ou credenciais embutidas', () => {
  const compatible = openAIResponseToGemini({
    output_text: 'Resposta.',
    output: [{
      type: 'message',
      content: [{
        annotations: [
          { type: 'url_citation', title: 'Ataque', url: 'javascript:alert(1)' },
          { type: 'url_citation', title: 'Segredo', url: 'https://user:pass@example.com/' },
          { type: 'url_citation', title: 'Válida', url: 'https://example.com/fonte' }
        ]
      }]
    }]
  });

  assert.equal(compatible.citations.length, 1);
  assert.equal(compatible.citations[0].uri, 'https://example.com/fonte');
  assert.doesNotMatch(compatible.text, /javascript:|user:pass/);
});
