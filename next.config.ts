import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Dev server runs on the NAS and is opened from other devices (LAN IP / Tailscale IP);
  // Next.js blocks dev resources for non-localhost origins unless listed. No effect on the export build.
  allowedDevOrigins: ['192.168.1.21', '100.73.1.57'],
};

export default nextConfig;
