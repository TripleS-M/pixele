import { getPlayerId } from '@/lib/auth';
import { getStats } from '@/lib/game';
import { handle, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(async () => json(getStats(await getPlayerId(false))));
