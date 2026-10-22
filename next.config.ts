import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Dev server runs on the NAS and is opened from other devices (LAN IP / Tailscale IP);
  // Next.js blocks dev resources for non-localhost origins unless listed. No effect on the export build.
  allowedDevOrigins: ['192.168.1.21', '100.73.1.57'],
  // The floating dev-tools badge sits on top of the navigation bar; not needed here.
  devIndicators: false,
};

export default nextConfig;
