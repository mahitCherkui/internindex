/**
 * Pull plain text out of an uploaded resume. PDF through pdf.js (unpdf's
 * serverless build), Word through mammoth; both run locally on the server and
 * nothing is sent anywhere else.
 */
export async function resumeText(file: { name: string; type: string; bytes: Uint8Array }): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return pdfText(file.bytes);
  if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) });
    return value;
  }
  if (name.endsWith('.doc')) throw new Error('Old .doc files can’t be read. Save it as PDF or .docx and upload again.');
  return new TextDecoder().decode(file.bytes);
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 6); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from positioned text so section headings stay on their own
    // line; pdf.js marks line ends with hasEOL, and a jump in y also breaks.
    let out = '';
    let lastY: number | null = null;
    for (const item of content.items as { str?: string; hasEOL?: boolean; transform?: number[] }[]) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5] ?? null;
      if (lastY != null && y != null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
      out += item.str;
      if (item.hasEOL) out += '\n';
      else if (item.str && !item.str.endsWith(' ')) out += ' ';
      if (y != null) lastY = y;
    }
    pages.push(out);
  }
  return pages.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
