import { getPlayerId } from '@/lib/auth';
import { authorizeImage } from '@/lib/game';
import { handle, json, sendImage } from '@/lib/http';
import { stagePath } from '@/lib/images';

export const dynamic = 'force-dynamic';

/** Serves one enhancement stage - but only stages this player has actually unlocked. */
export const GET = (_request: Request, { params }: { params: Promise<{ playId: string; stage: string }> }) =>
  handle(async () => {
    const { playId, stage } = await params;
    const playerId = await getPlayerId(false);
    const assetId = playerId ? authorizeImage(Number(playId), Number(stage), playerId) : null;
    if (!assetId) return json({ error: 'This enhancement pass has not been unlocked.' }, 403);
    return sendImage(stagePath(assetId, Number(stage)), 'private, max-age=600');
  });
