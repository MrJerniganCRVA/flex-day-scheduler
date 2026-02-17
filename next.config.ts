import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow Google profile images
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
