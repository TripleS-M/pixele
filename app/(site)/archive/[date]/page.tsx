import type { Metadata } from 'next';
import Game from '@/components/Game';

export const metadata: Metadata = { title: 'Practice' };

export default async function PracticePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return <Game gameKey={`practice:${date}`} />;
}
