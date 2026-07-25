import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import handler from '../api/index.ts';
import {
  isBlockedHostname,
  isBlockedIpAddress,
  normalizeClientId
} from '../src/server/security.ts';
import { close, listen, request } from './httpTestClient.ts';

test('bloqueia destinos internos, IPv4/IPv6 privados e IDs de sessão fracos', () => {
  for (const host of [
    'localhost',
    'service.internal',
    'printer.local',
    '127.0.0.1',
    '10.1.2.3',
    '192.168.1.2',
    '172.20.1.1',
    '169.254.169.254',
    '::1',
    'fc00::1',
    'fe80::1'
  ]) {
    assert.equal(isBlockedHostname(host), true, host);
  }
  assert.equal(isBlockedIpAddress('8.8.8.8'), false);
  assert.equal(normalizeClientId('short'), '');
  assert.equal(normalizeClientId('valid_client_identifier_123456'), 'valid_client_identifier_123456');
});

test('rejeita SSRF, rota antiga de segredo, JSON inválido e payload excessivo', async (t) => {
  const { server, baseUrl } = await listen(handler as any);
  t.after(() => close(server));
  const headers = {
    'X-OSONE-Client-ID': 'security_test_client_123456789'
  };

  const privateScrape = await request(baseUrl, '/api/scrape', {
    method: 'POST',
    headers,
    body: { url: 'http://169.254.169.254/latest/meta-data' }
  });
  assert.equal(privateScrape.status, 400);
  assert.match(privateScrape.json.error, /privado|interno/i);

  const secretRoute = await request(baseUrl, '/api/gemini/key', { headers });
  assert.equal(secretRoute.status, 404);
  assert.equal(JSON.stringify(secretRoute.json).includes('apiKey'), false);

  const unauthenticatedWebhook = await request(
    baseUrl,
    '/api/whatsapp/webhook',
    {
      method: 'POST',
      headers,
      body: { text: 'mensagem não autenticada' }
    }
  );
  assert.equal(unauthenticatedWebhook.status, 501);

  const malformed = await request(baseUrl, '/api/gemini/verify', {
    method: 'POST',
    headers,
    body: '{"geminiApiKey":'
  });
  assert.equal(malformed.status, 400);
  assert.match(malformed.json.error, /JSON inválido/i);

  const excessive = await request(baseUrl, '/api/gemini/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify({ geminiApiKey: 'x'.repeat(4_300_000) })
  });
  assert.equal(excessive.status, 413);

  const secretInMessage = 'sk-proj-secret-value-123456789';
  const simulated = await request(baseUrl, '/api/whatsapp/simulate-incoming', {
    method: 'POST',
    headers,
    body: {
      senderName: 'Teste',
      text: `Não registre ${secretInMessage}`
    }
  });
  assert.equal(simulated.status, 409);
  const logs = await request(baseUrl, '/api/whatsapp/logs', { headers });
  assert.equal(JSON.stringify(logs.json).includes(secretInMessage), false);
  assert.match(JSON.stringify(logs.json), /CHAVE_REMOVIDA/);
});

test('não injeta chaves, não reseta dados e não usa rotas inexistentes para voz ou documentos', async () => {
  const [
    viteConfig,
    mainSource,
    appSource,
    dossierSource,
    serviceWorker,
    liveBridge,
    profileStorage
  ] = await Promise.all([
    fs.readFile(new URL('../vite.config.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/components/IntimateMissionModal.tsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/lib/live-bridge.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/lib/indexedDbMemory.ts', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(viteConfig, /JSON\.stringify\(env\.GEMINI_API_KEY\)/);
  assert.doesNotMatch(appSource, /localStorage\.removeItem\('osone_api_keys'\)/);
  assert.doesNotMatch(appSource, /\/api\/elevenlabs-ws/);
  assert.doesNotMatch(appSource, /\/api\/system-docs/);
  assert.doesNotMatch(appSource, /api\.allorigins\.win/);
  assert.doesNotMatch(appSource, /setItem\('osone_tiktok_session_id'/);
  assert.doesNotMatch(appSource, /from ['"]\.\/firebase|Firebase Secure|Nuvem Ativa via Gmail/);
  assert.match(mainSource, /removeItem\('osone_tiktok_session_id'\)/);
  assert.match(mainSource, /sessionStorage\.getItem\("osone_active_api_keys_v1"\)/);
  assert.doesNotMatch(
    mainSource,
    /console\.error\("\[Vercel-OSONE Fallback\][^;]+,\s*err\)/
  );
  assert.doesNotMatch(dossierSource, /\/api\/dossier\/analyze/);
  assert.match(serviceWorker, /pathname\.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(liveBridge, /\/api\/gemini\/key/);
  assert.doesNotMatch(liveBridge, /\?apiKey=/);
  assert.match(profileStorage, /nash_memory_/);
  assert.match(profileStorage, /nash_diary_/);
});
