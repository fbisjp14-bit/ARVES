import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLocalProfile,
  normalizeLocalProfiles
} from '../src/lib/localProfiles.ts';

test('aceita somente perfis locais com identificador e nome seguros', () => {
  assert.deepEqual(
    normalizeLocalProfile({
      uid: 'local_1234567890abcdef',
      displayName: '  José\u0000 Silva  ',
      email: 'forjado@example.com',
      isLocal: true
    }),
    {
      uid: 'local_1234567890abcdef',
      displayName: 'José Silva',
      email: 'josesilva@osone.local',
      isLocal: true
    }
  );

  assert.equal(
    normalizeLocalProfile({
      uid: '../osone_guest',
      displayName: 'Invasor',
      isLocal: true
    }),
    null
  );
  assert.equal(
    normalizeLocalProfile({
      uid: 'local_1234567890abcdef',
      displayName: 'Sem marca local'
    }),
    null
  );
});

test('remove duplicatas, entradas corrompidas e excesso de perfis', () => {
  const candidates = Array.from({ length: 70 }, (_, index) => ({
    uid: `local_${String(index).padStart(12, '0')}`,
    displayName: `Pessoa ${index}`,
    isLocal: true
  }));
  candidates.splice(2, 0, {
    uid: 'local_000000000000',
    displayName: 'Nome duplicado',
    isLocal: true
  });
  candidates.splice(3, 0, {
    uid: 'local_999999999999',
    displayName: 'Pessoa 1',
    isLocal: true
  });

  const profiles = normalizeLocalProfiles(candidates);
  assert.equal(profiles.length, 50);
  assert.equal(new Set(profiles.map((profile) => profile.uid)).size, 50);
  assert.equal(
    new Set(profiles.map((profile) => profile.displayName.toLowerCase())).size,
    50
  );
});
