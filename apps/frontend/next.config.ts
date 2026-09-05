import type { NextConfig } from "next";

// Dev proxy: with NEXT_PUBLIC_API_URL=/api (apps/frontend/.env.local) the
// browser calls this server's own origin and Next forwards to the backend,
// so a phone on the LAN (http://<machine-ip>:3000) reaches the API without
// the backend having to know that origin (its CORS stays localhost-only).
// Without that variable the frontend keeps calling the backend directly.
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || "http://localhost:3101";

// Next 16 blocks its dev resources (chunks, HMR) for any origin but localhost;
// a phone on the LAN needs the machine's address listed here. Comma-separated
// DEV_ORIGINS overrides the default.
const DEV_ORIGINS = (process.env.DEV_ORIGINS || "192.168.1.12").split(",").map((s) => s.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: DEV_ORIGINS,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_PROXY_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
