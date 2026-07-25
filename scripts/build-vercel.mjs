import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  logLevel: 'info'
};

await build({
  ...shared,
  entryPoints: ['api/index.ts'],
  outfile: 'dist/vercel-function.cjs'
});

await build({
  ...shared,
  entryPoints: [
    'api/health.ts',
    'api/tts.ts',
    'api/openai/verify.ts',
    'api/openai/generate-compatible.ts',
    'api/openai/chat-intel-stream.ts',
    'api/openai/images.ts'
  ],
  outdir: 'dist/vercel-isolated',
  outExtension: { '.js': '.cjs' }
});
