import { adminOnly, json } from '@/lib/http';
import { scanLibrary } from '@/lib/ingest';

/** Re-scans the asset folder for new, moved or changed images. */
export const POST = () => adminOnly(async () => json(await scanLibrary()));
