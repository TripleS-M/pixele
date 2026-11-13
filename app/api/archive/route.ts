import { getPlayerId } from '@/lib/auth';
import { getArchive } from '@/lib/game';
import { handle, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(async () => json({ puzzles: getArchive(await getPlayerId(false)) }));
