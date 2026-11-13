import Shell from '@/components/Shell';
import { getConfig } from '@/lib/config';

// Rendered per request so changes to pixle.config.json apply without a rebuild.
export const dynamic = 'force-dynamic';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const { scoring, timezone } = getConfig();
  return (
    <Shell scoring={scoring} timezone={timezone}>
      {children}
    </Shell>
  );
}
