import { fail, handler, ok, requireUserId } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { parseResume } from '@/lib/parse/resume';
import { resumeText } from '@/lib/resume-text';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/resume: read a resume and return what it says, for review.
 *
 * Accepts multipart form data with a `file` (PDF, .docx or .txt) or JSON
 * `{ text }`. Nothing is saved here; the client shows the parsed fields and
 * saves the ones the student confirms through PATCH /api/profile.
 */
export const POST = handler(async (request: Request) => {
  if (!isDemo()) {
    const auth = await requireUserId();
    if (auth instanceof Response) return auth;
  }

  let text = '';
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('Attach a resume file.');
    if (file.size > MAX_BYTES) return fail('That file is over 5 MB. Upload a PDF or Word resume.');
    try {
      text = await resumeText({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    } catch (err) {
      return fail((err as Error).message || 'Could not read that file.');
    }
  } else {
    const body = (await request.json().catch(() => ({}))) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text : '';
  }

  text = text.slice(0, 60_000).trim();
  if (text.length < 80) {
    return fail('Not enough text came out of that resume. If it is a scanned image, paste the text instead.');
  }
  return ok({ text, parsed: parseResume(text) });
});
