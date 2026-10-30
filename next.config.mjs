/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.56.1"],
  experimental: {
    workerThreads: true,
  },
  turbopack: {
    root: process.cwd(),
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {

    const securityHeaders = [

      { key: "X-Content-Type-Options", value: "nosniff" },

      { key: "X-Frame-Options", value: "DENY" },

      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

      { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'${process.env.NODE_ENV === "development" ? " ws: wss:" : ""} https://va.vercel-scripts.com https://vitals.vercel-insights.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` },

    ];

    if (process.env.NODE_ENV === "production") securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });

    return [{ source: "/(.*)", headers: securityHeaders }];

  },

  images: {
    unoptimized: true,
  },
}

export default nextConfig
