import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/index.ts';
import { close, listen, request } from './httpTestClient.ts';

test('envia chave ElevenLabs somente no cabeçalho e devolve áudio pela rota HTTPS', async (t) => {
  const originalFetch = globalThis.fetch;
  let forwardedUrl = '';
  let forwardedKey = '';
  let forwardedBody: any;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    forwardedUrl = String(input);
    forwardedKey = new Headers(init?.headers).get('xi-api-key') || '';
    forwardedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(new Uint8Array([73, 68, 51, 4]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { server, baseUrl } = await listen(handler as any);
  t.after(() => close(server));

  const response = await request(baseUrl, '/api/tts', {
    method: 'POST',
    headers: {
      'X-OSONE-Client-ID': `tts_client_${'x'.repeat(24)}`
    },
    body: {
      text: 'Teste de voz',
      engine: 'elevenlabs',
      elevenLabsApiKey: 'eleven-secret-key',
      elevenLabsVoiceId: 'voice_123',
      elevenLabsModel: 'eleven_flash_v2_5'
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'audio/mpeg');
  assert.equal(response.headers['x-tts-mode'], 'elevenlabs');
  assert.equal(Buffer.byteLength(response.text, 'binary'), 4);
  assert.match(forwardedUrl, /\/text-to-speech\/voice_123$/);
  assert.doesNotMatch(forwardedUrl, /eleven-secret-key/);
  assert.equal(forwardedKey, 'eleven-secret-key');
  assert.equal(forwardedBody.text, 'Teste de voz');
  assert.equal(forwardedBody.model_id, 'eleven_flash_v2_5');
});
