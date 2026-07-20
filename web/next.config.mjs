/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Proxy browser API calls through the web origin so the session cookie is
  // first-party. Safari blocks third-party cookies, which broke auth when the
  // browser called the railway API origin directly.
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
  webpack: (config) => {
    // Optional wallet-SDK deps we do not use (injected connector only).
    config.resolve.alias = {
      ...config.resolve.alias,
      "@base-org/account": false,
      "@coinbase/cdp-sdk": false,
      "@x402/evm": false,
    };
    return config;
  },
};

export default nextConfig;
