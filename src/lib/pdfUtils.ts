import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import type { Message } from '../types';

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const sanitizeHtml = (html: string): string => {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content
    .querySelectorAll('script, iframe, object, embed, link, meta, form')
    .forEach((element) => element.remove());

  template.content.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith('on') ||
        (['href', 'src', 'xlink:href'].includes(name) && value.startsWith('javascript:'))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return template.innerHTML;
};

const markdownToPdfHtml = (markdown: string): string => {
  const lines = escapeHtml(markdown).split(/\r?\n/);
  const output: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 4);
      output.push(`<h${level}>${heading[2]}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const nextListType = unordered ? 'ul' : 'ol';
      if (listType !== nextListType) {
        closeList();
        listType = nextListType;
        output.push(`<${listType}>`);
      }
      output.push(`<li>${unordered?.[1] || ordered?.[1]}</li>`);
      continue;
    }

    closeList();
    const formatted = line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
    output.push(`<p>${formatted}</p>`);
  }

  closeList();
  return output.join('\n');
};

const safeImageSource = (value: string | undefined): string => {
  if (!value) return '';
  if (
    /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value) ||
    /^https?:\/\//i.test(value) ||
    /^blob:/i.test(value)
  ) {
    return escapeHtml(value);
  }
  return '';
};

const waitForImages = async (container: HTMLElement): Promise<void> => {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(images.map((image) => new Promise<void>((resolve) => {
    if (image.complete) {
      resolve();
      return;
    }
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => resolve(), { once: true });
    window.setTimeout(resolve, 12_000);
  })));
};

const normalizePdfFileName = (fileName: string): string => {
  const sanitized = fileName
    .replace(/[/\\?%*:|"<>\u0000-\u001f]+/g, '_')
    .trim() || 'documento-osone.pdf';
  return sanitized.toLowerCase().endsWith('.pdf')
    ? sanitized
    : `${sanitized}.pdf`;
};

export async function generatePDF(
  htmlContent: string,
  fileName: string = 'documento-osone.pdf'
): Promise<void> {
  const container = document.createElement('article');
  container.setAttribute('aria-hidden', 'true');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = '794px';
  container.style.boxSizing = 'border-box';
  container.style.padding = '56px 64px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#1f2937';
  container.style.fontFamily = 'Inter, Arial, sans-serif';
  container.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; color: #111827; }
      h1 { font-family: Georgia, serif; font-size: 32px; line-height: 1.2; margin: 0 0 24px; border-bottom: 3px solid #f97316; padding-bottom: 16px; }
      h2 { font-family: Georgia, serif; font-size: 24px; line-height: 1.3; margin: 32px 0 14px; }
      h3 { font-size: 19px; line-height: 1.4; margin: 26px 0 12px; }
      h4 { font-size: 16px; line-height: 1.4; margin: 22px 0 10px; }
      p { font-size: 14px; line-height: 1.7; color: #374151; margin: 0 0 14px; white-space: normal; overflow-wrap: anywhere; }
      ul, ol { margin: 8px 0 18px; padding-left: 26px; }
      li { margin-bottom: 7px; color: #374151; font-size: 14px; line-height: 1.6; }
      blockquote { border-left: 4px solid #f97316; margin: 18px 0; padding: 12px 18px; color: #4b5563; background: #fff7ed; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 14px; border-radius: 8px; background: #111827; color: #f9fafb; font-size: 12px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f3f4f6; color: #c2410c; padding: 2px 5px; border-radius: 4px; }
      table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
      th { background: #f3f4f6; color: #111827; }
      img { display: block; max-width: 100%; height: auto; margin: 16px auto; border-radius: 10px; }
      a { color: #0369a1; text-decoration: underline; overflow-wrap: anywhere; }
      .osone-pdf-cover { border-radius: 16px; padding: 26px; color: #fff; background: linear-gradient(135deg, #111827, #431407); margin-bottom: 28px; }
      .osone-pdf-cover h1 { color: #fff; border-color: #fb923c; margin-bottom: 12px; }
      .osone-pdf-cover p { color: #fed7aa; margin: 0; }
      .osone-message { margin: 0 0 18px; padding: 16px 18px; border-radius: 12px; border: 1px solid #e5e7eb; background: #f9fafb; break-inside: avoid-page; }
      .osone-message.user { border-left: 4px solid #f97316; background: #fff7ed; }
      .osone-message.assistant { border-left: 4px solid #111827; }
      .osone-message-label { display: block; margin-bottom: 9px; color: #6b7280; font-size: 10px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      .osone-pdf-footer { margin-top: 36px; border-top: 1px solid #e5e7eb; padding-top: 14px; color: #9ca3af; text-align: center; font-size: 10px; letter-spacing: .08em; }
    </style>
    ${sanitizeHtml(htmlContent)}
    <div class="osone-pdf-footer">Gerado pelo OSONE • ${new Date().toLocaleString('pt-BR')}</div>
  `;

  document.body.appendChild(container);

  try {
    await document.fonts?.ready;
    await waitForImages(container);
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: '#ffffff',
      imageTimeout: 15_000
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const marginX = 12;
    const marginTop = 12;
    const marginBottom = 15;
    const printableWidth = pageWidth - (marginX * 2);
    const printableHeight = pageHeight - marginTop - marginBottom;
    const pixelsPerMillimeter = canvas.width / printableWidth;
    const pageHeightInPixels = Math.max(
      1,
      Math.floor(printableHeight * pixelsPerMillimeter)
    );
    const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightInPixels));

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      if (pageIndex > 0) pdf.addPage();
      const sourceY = pageIndex * pageHeightInPixels;
      const sourceHeight = Math.min(
        pageHeightInPixels,
        canvas.height - sourceY
      );
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sourceHeight;
      const context = pageCanvas.getContext('2d');
      if (!context) throw new Error('Não foi possível paginar o documento.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        sourceHeight,
        0,
        0,
        canvas.width,
        sourceHeight
      );

      const renderedHeight = sourceHeight / pixelsPerMillimeter;
      pdf.addImage(
        pageCanvas.toDataURL('image/jpeg', 0.94),
        'JPEG',
        marginX,
        marginTop,
        printableWidth,
        renderedHeight,
        undefined,
        'FAST'
      );
      pdf.setFontSize(8);
      pdf.setTextColor(150);
      pdf.text(
        `${pageIndex + 1} / ${totalPages}`,
        pageWidth / 2,
        pageHeight - 6,
        { align: 'center' }
      );
    }

    pdf.save(normalizePdfFileName(fileName));
  } catch (error) {
    console.error('PDF Generation Error:', error);
    throw error;
  } finally {
    container.remove();
  }
}

export const buildConversationPdfHtml = (
  messages: Pick<Message, 'role' | 'content' | 'imageUrl'>[],
  title: string
): string => {
  const safeTitle = escapeHtml(title || 'Conversa OSONE');
  const messageBlocks = messages.map((message) => {
    const roleLabel = message.role === 'user' ? 'Você' : 'OSONE';
    const imageSource = safeImageSource(message.imageUrl);
    return `
      <section class="osone-message ${message.role}">
        <span class="osone-message-label">${roleLabel}</span>
        ${markdownToPdfHtml(message.content || '')}
        ${imageSource ? `<img src="${imageSource}" alt="Imagem da conversa" />` : ''}
      </section>
    `;
  }).join('\n');

  return `
    <header class="osone-pdf-cover">
      <h1>${safeTitle}</h1>
      <p>Conversa exportada em ${new Date().toLocaleString('pt-BR')}</p>
    </header>
    ${messageBlocks}
  `;
};

export async function generateConversationPDF(
  messages: Pick<Message, 'role' | 'content' | 'imageUrl'>[],
  title: string = 'Conversa OSONE'
): Promise<void> {
  if (messages.length === 0) {
    throw new Error('Não há mensagens para exportar.');
  }
  const fileName = `${title || 'conversa-osone'}`
    .replace(/[/\\?%*:|"<>\s]+/g, '_')
    .toLowerCase();
  await generatePDF(
    buildConversationPdfHtml(messages, title),
    `${fileName}.pdf`
  );
}
