import type { NextConfig } from "next";

// The deploy environment is fixed at build time, never read from the URL. An
// unknown build (no VERCEL_ENV, not `next dev`) is treated as production.
const deployEnv =
  process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "development" ? "development" : "production");

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_LOREBOOK_DEPLOY_ENV: deployEnv },
};

export default nextConfig;
