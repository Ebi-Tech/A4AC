import type { NextConfig } from "next";

const tunnelHosts = (process.env.DEV_TUNNEL_HOSTS ?? "*.trycloudflare.com")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/**": ["./content/**/*", "./config/**/*"],
  },
  allowedDevOrigins: isDev ? tunnelHosts : [],
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
      allowedOrigins: isDev ? tunnelHosts : [],
    },
  },
};

export default nextConfig;
