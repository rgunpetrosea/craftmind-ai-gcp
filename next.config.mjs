/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cloud Run: a minimal self-contained server (.next/standalone/server.js) for the Docker image
  output: "standalone",
  images: {
    remotePatterns: [{ protocol: "https", hostname: "storage.googleapis.com" }],
  },
};

export default nextConfig;
