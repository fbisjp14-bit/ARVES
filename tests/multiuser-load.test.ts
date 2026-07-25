import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/index.ts';
import { close, listen, request } from './httpTestClient.ts';

const clientId = (index: number): string =>
  `client_${String(index).padStart(3, '0')}_${'x'.repeat(24)}`;

test('simula 40 usuários simultâneos sem misturar chaves, configurações ou sessões', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const openAIKey = headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (openAIKey) {
      if (String(_input).endsWith('/responses')) {
        return new Response(JSON.stringify({
          model: 'gpt-5.4-mini',
          output_text: `openai:${openAIKey}`,
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: `openai:${openAIKey}`, annotations: [] }]
          }]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5.4-mini' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const geminiKey = headers.get('x-goog-api-key') || '';
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 8)));
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: `gemini:${geminiKey}` }]
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

  const users = Array.from({ length: 40 }, (_, index) => ({
    index,
    clientId: clientId(index),
    geminiKey: `gemini-secret-${index}`,
    openAIKey: `sk-openai-secret-${index}`,
    whatsappKey: `wa-secret-${index}`,
    username: `user_${index}`
  }));

  await Promise.all(users.flatMap((user) => {
    const headers = { 'X-OSONE-Client-ID': user.clientId };
    return [
      request(baseUrl, '/api/whatsapp/config', {
        method: 'POST',
        headers,
        body: {
          apiUrl: `https://evolution-${user.index}.example.com`,
          apiKey: user.whatsappKey,
          instanceName: `instance_${user.index}`,
          enabled: true,
          geminiApiKey: user.geminiKey
        }
      }),
      request(baseUrl, '/api/tiktok/connect', {
        method: 'POST',
        headers,
        body: {
          username: user.username,
          simulate: true
        }
      })
    ];
  }));

  const geminiResults = await Promise.all(users.map((user) =>
    request(baseUrl, '/api/gemini/generateContent', {
      method: 'POST',
      headers: { 'X-OSONE-Client-ID': user.clientId },
      body: {
        clientApiKey: user.geminiKey,
        model: 'gemini-3.5-flash',
        contents: 'ping'
      }
    })
  ));
  geminiResults.forEach((result, index) => {
    assert.equal(result.status, 200);
    assert.equal(result.json.text, `gemini:${users[index].geminiKey}`);
  });

  const openAIResults = await Promise.all(users.map((user) =>
    request(baseUrl, '/api/openai/generate-compatible', {
      method: 'POST',
      headers: { 'X-OSONE-Client-ID': user.clientId },
      body: {
        openaiApiKey: user.openAIKey,
        openaiModel: 'gpt-5.4-mini',
        contents: 'ping'
      }
    })
  ));
  openAIResults.forEach((result, index) => {
    assert.equal(result.status, 200);
    assert.match(result.json.text, new RegExp(`openai:${users[index].openAIKey}$`));
  });

  const isolatedState = await Promise.all(users.map(async (user) => {
    const headers = { 'X-OSONE-Client-ID': user.clientId };
    const [config, tiktok] = await Promise.all([
      request(baseUrl, '/api/whatsapp/config', { headers }),
      request(baseUrl, '/api/tiktok/state', { headers })
    ]);
    return { config, tiktok };
  }));

  isolatedState.forEach(({ config, tiktok }, index) => {
    const expected = users[index];
    assert.equal(config.status, 200);
    assert.equal(config.json.apiKey, undefined);
    assert.equal(config.json.geminiApiKey, undefined);
    assert.equal(JSON.stringify(config.json).includes(expected.whatsappKey), false);
    assert.equal(JSON.stringify(config.json).includes(expected.geminiKey), false);
    assert.equal(config.json.apiUrl, `https://evolution-${expected.index}.example.com`);
    assert.equal(config.json.instanceName, `instance_${expected.index}`);
    assert.equal(tiktok.status, 200);
    assert.equal(tiktok.json.username, expected.username);

    const serialized = JSON.stringify({ config: config.json, tiktok: tiktok.json });
    for (const other of users) {
      if (other.index === index) continue;
      assert.equal(serialized.includes(JSON.stringify(other.whatsappKey)), false);
      assert.equal(serialized.includes(JSON.stringify(other.geminiKey)), false);
      assert.equal(serialized.includes(`"${other.username}"`), false);
    }
  });
});

test('limita tempestade de requisições de uma única sessão sem bloquear outros usuários', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const key = new Headers(init?.headers).get('x-goog-api-key') || '';
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: key }] } }]
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
  const noisyClient = clientId(999);
  const requestBody = {
    clientApiKey: 'noisy-key',
    model: 'gemini-3.5-flash',
    contents: 'ping'
  };
  const burst = await Promise.all(
    Array.from({ length: 20 }, () =>
      request(baseUrl, '/api/gemini/generateContent', {
        method: 'POST',
        headers: { 'X-OSONE-Client-ID': noisyClient },
        body: requestBody
      })
    )
  );

  assert.ok(burst.some((result) => result.status === 429));
  assert.ok(burst.filter((result) => result.status === 200).length <= 8);

  const otherUser = await request(baseUrl, '/api/gemini/generateContent', {
    method: 'POST',
    headers: { 'X-OSONE-Client-ID': clientId(1000) },
    body: {
      ...requestBody,
      clientApiKey: 'other-key'
    }
  });
  assert.equal(otherUser.status, 200);
  assert.equal(otherUser.json.text, 'other-key');
});

test('limita abuso sequencial por sessão e informa quando tentar novamente', async (t) => {
  const { server, baseUrl } = await listen(handler as any);
  t.after(() => close(server));
  const headers = {
    'X-OSONE-Client-ID': 'rate_limit_client_identifier_123456789'
  };

  let lastResponse: Awaited<ReturnType<typeof request>> | undefined;
  for (let index = 0; index < 241; index++) {
    lastResponse = await request(baseUrl, '/api/tiktok/state', { headers });
  }

  assert.equal(lastResponse?.status, 429);
  assert.equal(lastResponse?.headers['retry-after'], '60');
  assert.match(lastResponse?.json.error || '', /limite temporário/i);
});
