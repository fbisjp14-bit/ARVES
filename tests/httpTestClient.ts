import http from 'node:http';

export interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

export const listen = async (
  handler: http.RequestListener
): Promise<{ server: http.Server; baseUrl: URL }> => {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Servidor de teste sem endereço TCP.');
  }
  return {
    server,
    baseUrl: new URL(`http://127.0.0.1:${address.port}`)
  };
};

export const request = async (
  baseUrl: URL,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | object;
  } = {}
): Promise<TestResponse> => {
  const body =
    typeof options.body === 'string'
      ? options.body
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  if (body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(body));

  return new Promise<TestResponse>((resolve, reject) => {
    const req = http.request(
      new URL(path, baseUrl),
      {
        method: options.method || 'GET',
        headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any = undefined;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {}
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text,
            json
          });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
};

export const close = async (server: http.Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
};
