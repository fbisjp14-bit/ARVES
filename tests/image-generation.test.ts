import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/index.ts';
import { close, listen, request } from './httpTestClient.ts';

test('valida chave OpenAI por uma rota gratuita sem iniciar geração', async (t) => {
  const originalFetch = globalThis.fetch;
  let forwardedUrl = '';
  let forwardedMethod = '';
  let forwardedAuthorization = '';

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    forwardedUrl = String(input);
    forwardedMethod = String(init?.method || 'GET');
    forwardedAuthorization = new Headers(init?.headers).get('authorization') || '';
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { server, baseUrl } = await listen(handler as any);
  t.after(() => close(server));
  const response = await request(baseUrl, '/api/openai/verify', {
    method: 'POST',
    headers: {
      'X-OSONE-Client-ID': `verify_openai_${'x'.repeat(24)}`
    },
    body: { openaiApiKey: 'sk-verify-test-key' }
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.match(forwardedUrl, /\/models$/);
  assert.equal(forwardedMethod, 'GET');
  assert.equal(forwardedAuthorization, 'Bearer sk-verify-test-key');
  assert.doesNotMatch(forwardedUrl, /responses|images/);
});

test('gera imagem OpenAI com GPT Image 2 e não usa modelo de texto', async (t) => {
  const originalFetch = globalThis.fetch;
  let forwardedUrl = '';
  let forwardedBody: any;
  let forwardedAuthorization = '';

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    forwardedUrl = String(input);
    forwardedBody = JSON.parse(String(init?.body || '{}'));
    forwardedAuthorization = new Headers(init?.headers).get('authorization') || '';
    return new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2Vt' }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { server, baseUrl } = await listen(handler as any);
  t.after(() => close(server));

  const response = await request(baseUrl, '/api/openai/images', {
    method: 'POST',
    headers: {
      'X-OSONE-Client-ID': `image_openai_${'x'.repeat(24)}`
    },
    body: {
      openaiApiKey: 'sk-image-test-key',
      prompt: 'Uma cidade futurista ao amanhecer',
      openaiImageQuality: 'high',
      config: { aspectRatio: '16:9' }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.model, 'gpt-image-2');
  assert.equal(response.json.outputMimeType, 'image/png');
  assert.equal(response.json.generatedImages[0].image.imageBytes, 'aW1hZ2Vt');
  assert.match(forwardedUrl, /\/images\/generations$/);
  assert.equal(forwardedAuthorization, 'Bearer sk-image-test-key');
  assert.equal(forwardedBody.model, 'gpt-image-2');
  assert.equal(forwardedBody.size, '1536x1024');
  assert.equal(forwardedBody.quality, 'high');
});

test('corrige automaticamente modelo Gemini textual em pedido de imagem', async (t) => {
  const originalFetch = globalThis.fetch;
  let forwardedUrl = '';
  let forwardedBody: any;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    forwardedUrl = String(input);
    forwardedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'image/png',
              data: 'Z2VtaW5pLWltYWdl'
            }
          }]
        }
      }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { server, baseUrl } = await listen(handler as any);
  t.after(() => close(server));

  const response = await request(baseUrl, '/api/gemini/generateImages', {
    method: 'POST',
    headers: {
      'X-OSONE-Client-ID': `image_gemini_${'x'.repeat(24)}`
    },
    body: {
      clientApiKey: 'gemini-image-key',
      model: 'gemini-3.5-flash',
      prompt: 'Floresta sob a luz da lua',
      config: {
        aspectRatio: '9:16',
        imageSize: '2K'
      }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.json.generatedImages[0].image.imageBytes,
    'Z2VtaW5pLWltYWdl'
  );
  assert.match(
    forwardedUrl,
    /models\/gemini-3\.1-flash-image:generateContent$/
  );
  assert.equal(
    forwardedBody.generationConfig.imageConfig.aspectRatio,
    '9:16'
  );
  assert.equal(
    forwardedBody.generationConfig.imageConfig.imageSize,
    '2K'
  );
});
