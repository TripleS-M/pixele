import type { Metadata } from 'next';
import { VT323 } from 'next/font/google';
import MonitorPrototype from '@/components/prototype/MonitorPrototype';

const vt323 = VT323({ weight: '400', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = { title: 'Monitor prototype' };

export default function PrototypePage() {
  return <MonitorPrototype fontFamily={vt323.style.fontFamily} />;
}
