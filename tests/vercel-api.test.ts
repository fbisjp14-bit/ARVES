import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import handler from '../api/index.ts';

test('a Function serverless inicia e preserva as rotas reescritas', async (t) => {
  const server = http.createServer(handler as any);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(
    `${baseUrl}/api?__osone_path=health`
  );
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).ok, true);

  const verifyResponse = await fetch(
    `${baseUrl}/api?__osone_path=gemini%2Fverify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }
  );
  const verifyBody = await verifyResponse.json();
  assert.equal(verifyResponse.status, 400);
  assert.equal(verifyBody.success, false);
  assert.match(verifyBody.message, /obrigatória/i);
});
