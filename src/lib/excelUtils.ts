import JSZip from 'jszip';

type Row = Record<string, unknown>;

const escapeXml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const columnName = (index: number): string => {
  let result = '';
  let cursor = index + 1;
  while (cursor > 0) {
    const remainder = (cursor - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    cursor = Math.floor((cursor - 1) / 26);
  }
  return result;
};

const serializeString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const cellXml = (
  value: unknown,
  reference: string,
  header = false
): string => {
  const style = header ? ' s="1"' : '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"${style} t="n"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const stringValue = serializeString(value);
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(stringValue)}</t></is></c>`;
};

export const createXlsxBlob = async (input: unknown): Promise<Blob> => {
  const rows = Array.isArray(input)
    ? input.filter((row): row is Row => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    : [];
  if (rows.length === 0) {
    throw new Error('A planilha precisa conter ao menos uma linha de dados.');
  }
  if (rows.length > 50_000) {
    throw new Error('A planilha excede o limite seguro de 50.000 linhas.');
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (columns.length === 0) {
    throw new Error('Nenhuma coluna foi encontrada nos dados.');
  }
  if (columns.length > 200) {
    throw new Error('A planilha excede o limite seguro de 200 colunas.');
  }

  const sheetRows: string[] = [];
  sheetRows.push(
    `<row r="1">${columns.map((column, index) =>
      cellXml(column, `${columnName(index)}1`, true)
    ).join('')}</row>`
  );
  rows.forEach((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    sheetRows.push(
      `<row r="${excelRow}">${columns.map((column, columnIndex) =>
        cellXml(row[column], `${columnName(columnIndex)}${excelRow}`)
      ).join('')}</row>`
    );
  });

  const lastCell = `${columnName(columns.length - 1)}${rows.length + 1}`;
  const widths = columns.map((column, index) => {
    const longest = Math.max(
      column.length,
      ...rows.slice(0, 1_000).map((row) => serializeString(row[column]).length)
    );
    return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(60, Math.max(10, longest + 2))}" customWidth="1"/>`;
  }).join('');

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Planilha" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCell}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${widths}</cols>
  <sheetData>${sheetRows.join('')}</sheetData>
  <autoFilter ref="A1:${columnName(columns.length - 1)}${rows.length + 1}"/>
</worksheet>`);
  const now = new Date().toISOString();
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>OSONE</dc:creator><cp:lastModifiedBy>OSONE</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>OSONE</Application>
</Properties>`);

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
};

export const normalizeXlsxFileName = (value: unknown): string => {
  const safeName = String(value || 'planilha-osone')
    .replace(/[/\\?%*:|"<>\u0000-\u001f]+/g, '_')
    .trim() || 'planilha-osone';
  return safeName.toLowerCase().endsWith('.xlsx')
    ? safeName
    : `${safeName}.xlsx`;
};
