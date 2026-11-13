import { getPlayerId, isAdmin } from '@/lib/auth';
import { GameError, getGame, resetGame, submitGuess, useHint } from '@/lib/game';
import { handle, json, readBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = (request: Request) =>
  handle(async () => {
    const key = new URL(request.url).searchParams.get('key') ?? 'daily';
    const playerId = (await getPlayerId(true))!;
    return json(getGame(key, playerId, await isAdmin()));
  });

export const POST = (request: Request) =>
  handle(async () => {
    const body = await readBody(request);
    const key = typeof body.key === 'string' ? body.key : 'daily';
    const playerId = (await getPlayerId(true))!;
    const admin = await isAdmin();
    switch (body.action) {
      case 'guess':
        return json(submitGuess(key, playerId, admin, String(body.guess ?? '')));
      case 'hint':
        return json({ state: useHint(key, playerId, admin) });
      case 'reset':
        return json({ state: resetGame(key, playerId, admin) });
      default:
        throw new GameError(400, 'bad_action', 'Unknown action.');
    }
  });
