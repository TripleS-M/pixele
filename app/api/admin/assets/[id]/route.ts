import { AdminError, deleteAsset, describeAsset, updateAsset } from '@/lib/admin';
import { getAsset } from '@/lib/db';
import { adminOnly, json, readBody } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_request: Request, { params }: Ctx) =>
  adminOnly(async () => {
    const asset = getAsset((await params).id);
    if (!asset) throw new AdminError(404, 'Asset not found.');
    return json({ asset: describeAsset(asset) });
  });

export const PATCH = (request: Request, { params }: Ctx) =>
  adminOnly(async () => json({ asset: await updateAsset((await params).id, await readBody(request)) }));

export const DELETE = (_request: Request, { params }: Ctx) =>
  adminOnly(async () => {
    deleteAsset((await params).id);
    return json({ ok: true });
  });
