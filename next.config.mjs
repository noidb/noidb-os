/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/wms/**": ["./lib/wms/data/hanjin-template-static/*.xlsx"],
    },
  },
};
export default nextConfig;
