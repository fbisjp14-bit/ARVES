import express from 'express';
import path from 'node:path';
import apiApp from './api/serverless.ts';

const start = async (): Promise<void> => {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), microphone=(self), geolocation=(self), display-capture=(self)'
    );
    next();
  });
  app.use(apiApp);

  if (process.env.NODE_ENV === 'production') {
    const distDirectory = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDirectory, {
      index: false,
      maxAge: '1y',
      immutable: true
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(path.join(distDirectory, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`OSONE disponível em http://${host}:${port}`);
  });
};

start().catch((error) => {
  console.error('Falha ao iniciar o OSONE:', error);
  process.exitCode = 1;
});
