import type { NextConfig } from "next";

// Content-Security-Policy for the app.
// - `'unsafe-inline'` in script-src is required by Next.js inline bootstrap.
// - `'wasm-unsafe-eval'` covers WebAssembly. The Next.js/Turbopack dev runtime
//   additionally needs `'unsafe-eval'`, so it is added in development only;
//   the production build keeps the tighter policy without it.
// - connect-src permits Supabase self-hosted endpoint, Telegram API, and Inngest.
// - img-src allows WB basket CDN where product photos live.
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`;
const CSP = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.wbbasket.ru",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://api.telegram.org https://*.inngest.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    webpackBuildWorker: false,
  },
  serverExternalPackages: ["@prisma/instrumentation"],
  async redirects() {
    return [
      {
        source: "/economics-template",
        destination: "/economics-v2",
        permanent: true,
      },
      {
        source: "/stocks",
        destination: "/stocks-v2",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/api/inngest": [
      "./node_modules/playwright/**/*",
      "./node_modules/playwright-core/**/*",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.wbbasket.ru",
      },
    ],
  },
};

export default nextConfig;
