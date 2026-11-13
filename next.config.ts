import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Dev server runs on the NAS and is opened from other devices (LAN IP / Tailscale IP);
  // Next.js blocks dev resources for non-localhost origins unless listed. No effect on the export build.
  allowedDevOrigins: ['192.168.1.21', '100.73.1.57'],
  // The floating dev-tools badge sits on top of the navigation bar; not needed here.
  devIndicators: false,
  // Demo mode (NEXT_PUBLIC_DEMO=1, dev only) swaps in a fake database with example data.
  // Every other build points that import at a stub, so none of it ships.
  ...(process.env.NEXT_PUBLIC_DEMO === '1' ? {} : {
    turbopack: { resolveAlias: { '@/lib/demo/client': './lib/demo/off.ts' } },
  }),
};

export default nextConfig;
