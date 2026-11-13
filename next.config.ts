import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['sharp'],
  devIndicators: false,
  // Lets `npm run dev` be opened through a Cloudflare quick tunnel (see README).
  allowedDevOrigins: ['*.trycloudflare.com'],
};

export default config;
