import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecentTextHistory,
  MAX_AI_ATTACHMENTS,
  MAX_HISTORY_CHARACTERS,
  selectAiAttachments
} from '../src/lib/requestLimits.ts';

test('limita anexos antes de criar um payload maior que a Function', () => {
  const files = [
    { name: 'a.png', size: 900_000 },
    { name: 'b.png', size: 900_000 },
    { name: 'c.pdf', size: 900_000 },
    { name: 'grande.png', size: 3_000_000 }
  ];
  const result = selectAiAttachments([], files);
  assert.equal(result.accepted.length, MAX_AI_ATTACHMENTS);
  assert.deepEqual(result.rejected.map((file) => file.name), ['grande.png']);

  const overflow = selectAiAttachments(result.accepted, [
    { name: 'extra.txt', size: 1 }
  ]);
  assert.equal(overflow.accepted.length, MAX_AI_ATTACHMENTS);
  assert.equal(overflow.rejected[0].name, 'extra.txt');
});

test('reduz histórico longo preservando as mensagens mais recentes', () => {
  const messages = Array.from({ length: 200 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `${index}: ${'x'.repeat(5_000)}`
  }));
  const history = buildRecentTextHistory(messages);
  const total = history.reduce(
    (sum, item) => sum + item.parts[0].text.length,
    0
  );

  assert.ok(history.length <= 60);
  assert.ok(total <= MAX_HISTORY_CHARACTERS);
  assert.match(history.at(-1)?.parts[0].text || '', /^199:/);
  assert.doesNotMatch(history[0].parts[0].text, /^0:/);
});
