import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Without these, a client-side crash reaches the console as a minified
  // symbol with no file or line — the signup countdown bug surfaced only as
  // "Cannot access 't' before initialization", which took a bundle read to
  // place. The maps cost build time and are served to anyone who opens
  // devtools; this app ships no client-side secrets, and being able to read a
  // student's stack trace is worth more than obscuring the source.
  productionBrowserSourceMaps: true,

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
