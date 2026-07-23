import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichGeminiResponse,
  geminiApiFetch,
  normalizeGeminiApiKey,
  verifyGeminiApiKey
} from '../src/lib/geminiApi.ts';
import {
  isStaticProductionHost,
  shouldUseApiFallback
} from '../src/lib/apiFallback.ts';
import { restoreVercelApiPath } from '../src/lib/vercelApiPath.ts';

test('normaliza a chave sem alterar seu conteúdo interno', () => {
  assert.equal(normalizeGeminiApiKey('  chave-teste  '), 'chave-teste');
  assert.equal(normalizeGeminiApiKey(undefined), '');
});

test('autentica com x-goog-api-key e nunca com Bearer', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  await geminiApiFetch(
    '/models?pageSize=1',
    '  auth-key-123  ',
    {
      method: 'GET',
      headers: { Authorization: 'Bearer auth-key-123' }
    },
    fakeFetch
  );

  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('x-goog-api-key'), 'auth-key-123');
  assert.equal(headers.has('Authorization'), false);
  assert.equal(capturedUrl.includes('?key='), false);
});

test('valida a chave listando modelos sem gastar uma geração', async () => {
  let capturedUrl = '';
  let capturedMethod = '';
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedMethod = init?.method || '';
    return new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.5-flash' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const result = await verifyGeminiApiKey('auth-key-123', fakeFetch);

  assert.equal(result.success, true);
  assert.equal(capturedMethod, 'GET');
  assert.match(capturedUrl, /\/v1beta\/models\?pageSize=1$/);
  assert.equal(capturedUrl.includes('generateContent'), false);
});

test('preserva texto e chamadas de função da resposta Gemini', () => {
  const enriched = enrichGeminiResponse({
    candidates: [
      {
        content: {
          parts: [
            { text: 'Resposta pronta.' },
            { functionCall: { name: 'show_notification', args: { message: 'ok' } } }
          ]
        }
      }
    ]
  });

  assert.equal(enriched.text, 'Resposta pronta.');
  assert.deepEqual(enriched.functionCalls, [
    { name: 'show_notification', args: { message: 'ok' } }
  ]);
});

test('restaura a rota completa da API depois do rewrite do Vercel', () => {
  const req = {
    url: '/api?__osone_path=gemini%2Fverify&file=teste.md',
    query: {
      __osone_path: 'gemini/verify',
      file: 'teste.md'
    }
  };

  restoreVercelApiPath(req);

  assert.equal(req.url, '/api/gemini/verify?file=teste.md');
});

test('restaura a rota usando a própria URL quando req.query não existe', () => {
  const req = {
    url: '/api?__osone_path=gemini%2Fverify'
  };

  restoreVercelApiPath(req);

  assert.equal(req.url, '/api/gemini/verify');
});

test('ativa fallback quando a Function da Vercel cai com HTTP 500', () => {
  const failedFunctionResponse = new Response(
    'FUNCTION_INVOCATION_FAILED',
    {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'X-Vercel-Error': 'FUNCTION_INVOCATION_FAILED'
      }
    }
  );

  assert.equal(
    shouldUseApiFallback(
      failedFunctionResponse,
      'https://exemplo.vercel.app/api/gemini/verify'
    ),
    true
  );
});

test('preserva erros JSON válidos e reconhece domínios de produção', () => {
  const invalidKeyResponse = new Response(
    JSON.stringify({ success: false }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    }
  );

  assert.equal(
    shouldUseApiFallback(
      invalidKeyResponse,
      'https://exemplo.vercel.app/api/gemini/verify'
    ),
    false
  );
  assert.equal(isStaticProductionHost('dominio-personalizado.com', true), true);
  assert.equal(isStaticProductionHost('localhost', true), false);
});
