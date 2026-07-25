import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalSnapshotId,
  LOCAL_SNAPSHOT_ID_PATTERN,
  sanitizeSnapshotPayload
} from '../src/lib/localSnapshot.ts';

test('snapshot local remove credenciais diretas e aninhadas', () => {
  const safe = sanitizeSnapshotPayload({
    osone_api_keys: JSON.stringify({ gemini: 'AIza-secreta' }),
    osone_tiktok_session_id: 'cookie-secreto',
    osone_ai_profile: JSON.stringify({
      name: 'Assistente',
      personality: 'calma',
      obsidianConfig: {
        baseUrl: 'http://127.0.0.1:27123',
        apiKey: 'obsidian-secreta'
      }
    }),
    osone_whatsapp_config_v2: JSON.stringify({
      apiUrl: 'https://evolution.exemplo',
      apiKey: 'whatsapp-secreta',
      instance: 'principal'
    }),
    osone_chat_history: JSON.stringify([{ role: 'user', content: 'Olá' }]),
    osone_local_snapshot_ANTIGO: 'não deve duplicar snapshots'
  });

  assert.equal(safe.osone_api_keys, undefined);
  assert.equal(safe.osone_tiktok_session_id, undefined);
  assert.equal(safe.osone_local_snapshot_ANTIGO, undefined);
  assert.deepEqual(JSON.parse(safe.osone_ai_profile), {
    name: 'Assistente',
    personality: 'calma',
    obsidianConfig: {
      baseUrl: 'http://127.0.0.1:27123'
    }
  });
  assert.deepEqual(JSON.parse(safe.osone_whatsapp_config_v2), {
    apiUrl: 'https://evolution.exemplo',
    instance: 'principal'
  });
  assert.match(safe.osone_chat_history, /Olá/);
});

test('gera IDs locais aleatórios no formato estrito', () => {
  const first = createLocalSnapshotId();
  const second = createLocalSnapshotId();
  assert.match(first, LOCAL_SNAPSHOT_ID_PATTERN);
  assert.match(second, LOCAL_SNAPSHOT_ID_PATTERN);
  assert.notEqual(first, second);
});
