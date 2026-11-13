import Link from 'next/link';
import Game from '@/components/Game';

/** Test-play any asset exactly as players will see it. Never touches the schedule or statistics. */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="stack" style={{ maxWidth: 788, margin: '0 auto' }}>
      <Link className="btn small" href={`/admin/asset/${id}`} style={{ alignSelf: 'flex-start' }}>
        ← Back to asset
      </Link>
      <Game gameKey={`preview:${id}`} />
    </div>
  );
}
