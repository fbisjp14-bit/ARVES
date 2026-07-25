import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAiProfile,
  normalizeChatSessions,
  normalizeHealthData,
  normalizeIntimateAnswers,
  normalizeStoredMessages
} from '../src/lib/profileState.ts';

test('normaliza estado de perfil corrompido antes de renderizar ou trocar usuário', () => {
  const messages = normalizeStoredMessages([
    null,
    { role: 'admin', content: 'inválida' },
    { id: 'ok', role: 'user', content: 'Olá' },
    { id: 'url', role: 'assistant', content: 'Fonte', imageUrl: 'javascript:alert(1)' }
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].imageUrl, undefined);

  const sessions = normalizeChatSessions([
    { id: 'a', title: 'Primeira', createdAt: 1, messages },
    { id: 'a', title: 'Duplicada', messages: [] },
    { id: '', title: 'Sem ID', messages: [] }
  ]);
  assert.equal(sessions.length, 1);

  assert.deepEqual(normalizeIntimateAnswers({
    1: 'resposta',
    56: 'fora do intervalo',
    admin: 'ignorar'
  }), { 1: 'resposta' });

  assert.equal(normalizeAiProfile({ name: 123 }).name, 'OSONE');
  assert.deepEqual(normalizeHealthData([]), {
    age: '',
    weight: '',
    height: '',
    gender: 'masculino',
    stylePreference: 'casual'
  });
});
