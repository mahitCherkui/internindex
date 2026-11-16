import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A second dev server (e.g. the editor's preview next to your own
  // `npm run dev`) needs its own build folder, or the two delete each other's
  // compiled output and pages load without CSS.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // pg is a server-only driver; keep it out of the client bundle graph.
  serverExternalPackages: ['pg'],
  experimental: {
    // Search and tracker pages read the DB on every request.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
