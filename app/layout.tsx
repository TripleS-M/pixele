import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, VT323 } from 'next/font/google';
import './globals.css';

const vt323 = VT323({ weight: '400', subsets: ['latin'], variable: '--font-vt323', display: 'swap' });
const plex = IBM_Plex_Mono({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Pixle — the daily image enhancement puzzle', template: '%s · Pixle' },
  description:
    'A corrupted image, five guesses. Every wrong guess makes the computer enhance the picture a little more. Can you identify it first?',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0d0a05' },
    { media: '(prefers-color-scheme: light)', color: '#e9e4d2' },
  ],
};

// Applies a saved theme before first paint (no flash).
const themeScript = `try{var t=localStorage.getItem('pixle:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${vt323.variable} ${plex.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
