// Baseline security headers applied to every response. Kept conservative
// so the dashboard's existing inline styles, Razorpay checkout, and the
// dev HMR socket all still work. Tighten `script-src` once a strict
// nonce pipeline is in place; for now the unsafe-inline / unsafe-eval
// allowance reflects Next's dev + bundle behaviour.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://js.stripe.com",
      "frame-src https://api.razorpay.com https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.razorpay.com https://api.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
    // Client-side Router Cache: don't reuse dynamic-route renders across soft
    // navigations. `force-dynamic` only governs the SERVER render — the client
    // still served a cached RSC payload for ~30s, so a roster change (e.g. a
    // newly added user) didn't appear in dropdowns like /tasks/new until a hard
    // refresh. 0 = always refetch dynamic routes on navigation. (This is Next
    // 15's default; we set it explicitly on 14.2.) Static routes keep theirs.
    staleTimes: { dynamic: 0 },
  },
  // lib/sentry.ts (and lib/sweeps/alert.ts) require("@sentry/nextjs") only when
  // SENTRY_DSN is set, so the package is intentionally NOT installed by default.
  // Webpack still statically resolves that require() at build time regardless of
  // the surrounding try/catch, printing a "Module not found" warning on every
  // build while it's absent. Marking it a server-side external makes Webpack
  // emit a plain runtime require() instead of resolving/bundling it — the
  // guarded try/catch then no-ops cleanly when it isn't installed, and it just
  // works if someone later does `npm install @sentry/nextjs`.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        { "@sentry/nextjs": "commonjs @sentry/nextjs" },
      ];
    }
    return config;
  },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  // In S3 mode (S3_PUBLIC_URL set), uploads aren't written to public/uploads — forward
  // /uploads/* reads to the configured bucket prefix so DB rows that store `/uploads/<file>`
  // resolve the same way they do in dev. Paired with the S3 branch in lib/storage.ts.
  async rewrites() {
    const pub = process.env.S3_PUBLIC_URL;
    if (!pub) return [];
    return [
      { source: "/uploads/:path*", destination: `${pub.replace(/\/$/, "")}/:path*` },
    ];
  },
};

export default nextConfig;
