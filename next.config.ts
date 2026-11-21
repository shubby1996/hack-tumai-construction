import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Cats Track UI (public/app) is the homepage; the earlier React UI lives at /classic.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/app/index.html" }], afterFiles: [], fallback: [] };
  },
  async redirects() {
    return [
      { source: "/mock/:path*", destination: "/", permanent: false },
      // Static pages in public/ that use relative asset paths: send the short URL to the real file.
      { source: "/landing", destination: "/landing/index.html", permanent: false },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
