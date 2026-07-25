import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  createXlsxBlob,
  normalizeXlsxFileName
} from '../src/lib/excelUtils.ts';

test('gera um XLSX válido sem a biblioteca xlsx vulnerável', async () => {
  const blob = await createXlsxBlob([
    { nome: 'Ana & Bia', total: 42, ativo: true },
    { nome: '<script>alert(1)</script>', total: 7.5, ativo: false }
  ]);
  assert.equal(
    blob.type,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );

  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.ok(archive.file('[Content_Types].xml'));
  assert.ok(archive.file('xl/workbook.xml'));
  const sheet = await archive.file('xl/worksheets/sheet1.xml')!.async('text');
  assert.match(sheet, /Ana &amp; Bia/);
  assert.match(sheet, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(sheet, /<v>42<\/v>/);
  assert.doesNotMatch(sheet, /<script>/);
});

test('normaliza nome e rejeita planilha vazia', async () => {
  assert.equal(normalizeXlsxFileName('../relatório:2026'), '.._relatório_2026.xlsx');
  await assert.rejects(() => createXlsxBlob([]), /ao menos uma linha/i);
});
