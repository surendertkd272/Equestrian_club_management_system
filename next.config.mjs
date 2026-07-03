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
    // lib/sentry.ts guards @sentry/nextjs behind a runtime require() so the
    // package never needs installing unless SENTRY_DSN is set. Webpack still
    // statically resolves require()/import() calls at build time regardless
    // of the try/catch around them, so without this it fails the build with
    // "Module not found" the moment the package isn't in node_modules. Marking
    // it external skips bundling — Node resolves it at runtime instead, which
    // only happens if that guarded branch actually runs.
    serverComponentsExternalPackages: ["@sentry/nextjs"],
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
