import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExternalHttpUrl } from '../src/lib/externalUrl.ts';

test('aceita apenas URLs HTTP externas sem credenciais', () => {
  assert.equal(
    normalizeExternalHttpUrl('https://example.com/fonte?q=1'),
    'https://example.com/fonte?q=1'
  );
  assert.equal(normalizeExternalHttpUrl('javascript:alert(1)'), null);
  assert.equal(normalizeExternalHttpUrl('data:text/html,<script>1</script>'), null);
  assert.equal(normalizeExternalHttpUrl('file:///etc/passwd'), null);
  assert.equal(normalizeExternalHttpUrl('https://user:pass@example.com'), null);
  assert.equal(normalizeExternalHttpUrl('não é URL'), null);
});
