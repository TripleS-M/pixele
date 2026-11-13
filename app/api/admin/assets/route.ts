import { listAssets } from '@/lib/admin';
import { getConfig } from '@/lib/config';
import { today } from '@/lib/dates';
import { adminOnly, json } from '@/lib/http';
import { ingestUpload, lastScan, scanLibrary, type UploadOutcome } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

export const GET = (request: Request) =>
  adminOnly(async () => {
    // Opening the dashboard also picks up anything dropped into the folder.
    if (new URL(request.url).searchParams.get('scan') === '1') await scanLibrary();
    return json({ assets: listAssets(), lastScan: lastScan(), today: today(), timezone: getConfig().timezone });
  });

/** Upload one or many images (multipart field "files"). Each becomes a draft asset. */
export const POST = (request: Request) =>
  adminOnly(async () => {
    const form = await request.formData();
    const category = form.get('category');
    const results: UploadOutcome[] = [];
    for (const entry of form.getAll('files')) {
      if (typeof entry === 'string') continue;
      if (entry.size > 40 * 1024 * 1024) {
        results.push({ name: entry.name, status: 'error', error: 'File is larger than 40 MB' });
        continue;
      }
      results.push(await ingestUpload(entry.name, Buffer.from(await entry.arrayBuffer()), category));
    }
    return json({ results });
  });
