import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 4174;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dist/server.cjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port)
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const waitForServer = new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error('O servidor de produção não iniciou em 10 segundos.'));
  }, 10_000);

  server.once('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`O servidor de produção encerrou com código ${code}.`));
  });
  server.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });
  server.stdout.on('data', (chunk) => {
    const output = String(chunk);
    if (!output.includes('OSONE disponível')) return;
    clearTimeout(timer);
    resolve();
  });
});

const clientId = (index) => `production_${index}_${'q'.repeat(24)}`;

try {
  await waitForServer;

  const indexResponse = await fetch(`${baseUrl}/`);
  const indexHtml = await indexResponse.text();
  assert.equal(indexResponse.status, 200);
  assert.equal(indexResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(indexResponse.headers.get('x-frame-options'), 'SAMEORIGIN');

  const assetPaths = [
    ...indexHtml.matchAll(/(?:src|href)="([^"#]+)"/g)
  ]
    .map((match) => match[1])
    .filter((path) => path.startsWith('/'));

  const assetStatuses = await Promise.all(assetPaths.map(async (path) => ({
    path,
    status: (await fetch(`${baseUrl}${path}`)).status
  })));
  assert.equal(
    assetStatuses.every(({ status }) => status === 200),
    true
  );

  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(health.ok, true);

  const users = Array.from({ length: 30 }, (_, index) => ({
    index,
    clientId: clientId(index),
    whatsappKey: `wa-${index}`,
    username: `user_${index}`
  }));

  const stateWrites = await Promise.all(users.flatMap((user) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-OSONE-Client-ID': user.clientId
    };
    return [
      fetch(`${baseUrl}/api/whatsapp/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          apiUrl: `https://evolution-${user.username}.example.com`,
          apiKey: user.whatsappKey,
          instanceName: user.username,
          enabled: true
        })
      }),
      fetch(`${baseUrl}/api/tiktok/connect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username: user.username,
          simulate: true
        })
      })
    ];
  }));
  assert.equal(stateWrites.every((response) => response.status === 200), true);

  const states = await Promise.all(users.map(async (user) => {
    const headers = { 'X-OSONE-Client-ID': user.clientId };
    return {
      whatsapp: await (
        await fetch(`${baseUrl}/api/whatsapp/config`, { headers })
      ).json(),
      tiktok: await (
        await fetch(`${baseUrl}/api/tiktok/state`, { headers })
      ).json()
    };
  }));

  states.forEach(({ whatsapp, tiktok }, index) => {
    assert.equal(whatsapp.apiKey, undefined);
    assert.equal(whatsapp.geminiApiKey, undefined);
    assert.equal(
      JSON.stringify(whatsapp).includes(users[index].whatsappKey),
      false
    );
    assert.equal(whatsapp.instanceName, users[index].username);
    assert.equal(tiktok.username, users[index].username);
  });

  const missingKey = await fetch(`${baseUrl}/api/gemini/generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OSONE-Client-ID': clientId(999)
    },
    body: '{}'
  });
  assert.equal(missingKey.status, 400);

  console.log(JSON.stringify({
    indexStatus: indexResponse.status,
    assetsChecked: assetStatuses.length,
    apiHealth: health.ok,
    isolatedProductionSessions: users.length,
    missingKeyStatus: missingKey.status
  }, null, 2));
} finally {
  server.kill('SIGTERM');
}
