import { FINAL_STAGE } from '@/lib/config';
import { adminOnly, json, sendImage } from '@/lib/http';
import { stagePath, thumbPath } from '@/lib/images';

/** Admin-only image access: /image/thumb, /image/1..5 (stages) or /image/6 (original) */
export const GET = (_request: Request, { params }: { params: Promise<{ id: string; stage: string }> }) =>
  adminOnly(async () => {
    const { id, stage } = await params;
    if (!/^px_[a-f0-9]+$/.test(id)) return json({ error: 'Not found.' }, 404);
    if (stage === 'thumb') return sendImage(thumbPath(id), 'no-store');
    const n = Number(stage);
    if (!Number.isInteger(n) || n < 1 || n > FINAL_STAGE) return json({ error: 'Not found.' }, 404);
    return sendImage(stagePath(id, n), 'no-store');
  });
