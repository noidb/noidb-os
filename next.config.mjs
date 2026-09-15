/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/wms/**": ["./lib/wms/data/hanjin-template-static/*.xlsx", "./lib/wms/data/coupon-templates/*.xlsx", "./lib/wms/data/discontinue-templates/*", "./lib/wms/templates/*.xlsx"],
    },
  },
};
export default nextConfig;
