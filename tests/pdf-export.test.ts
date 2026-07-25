import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConversationPdfHtml } from '../src/lib/pdfUtils.ts';

test('monta uma conversa formatada com texto e imagem para o PDF', () => {
  const html = buildConversationPdfHtml([
    {
      role: 'user',
      content: 'Crie um **relatório**.'
    },
    {
      role: 'assistant',
      content: '# Resultado\nDocumento concluído.',
      imageUrl: 'data:image/png;base64,AAAA'
    }
  ], 'Pesquisa OSONE');

  assert.match(html, /Pesquisa OSONE/);
  assert.match(html, /<strong>relatório<\/strong>/);
  assert.match(html, /<h2>Resultado<\/h2>/);
  assert.match(html, /data:image\/png;base64,AAAA/);
});

test('escapa conteúdo ativo e rejeita fontes de imagem perigosas', () => {
  const html = buildConversationPdfHtml([
    {
      role: 'assistant',
      content: '<script>alert("x")</script>',
      imageUrl: 'javascript:alert(1)'
    }
  ], '<img src=x onerror=alert(1)>');

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /&lt;script&gt;/);
});
