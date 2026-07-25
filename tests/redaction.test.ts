import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../src/lib/redaction.ts';

test('remove chaves conhecidas, tokens em URL e segredos explícitos de erros', () => {
  const explicit = 'eleven-secret-value';
  const sanitized = redactSecrets(
    `AIza123456789abcdefghijklmnop sk-proj-abcdefghijklmnop ` +
    `Bearer abc.def.ghi https://example.com/?apiKey=valor-secreto ${explicit}`,
    [explicit]
  );

  assert.doesNotMatch(sanitized, /AIza|sk-proj|abc\.def|valor-secreto|eleven-secret/);
  assert.match(sanitized, /\[CHAVE_REMOVIDA\]/);
});
