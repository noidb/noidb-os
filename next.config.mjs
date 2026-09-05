/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/wms/**": [
        "./lib/wms/data/hanjin-template-static/*.xlsx",
        "./lib/wms/data/discontinue-templates/*.xlsx",
        "./lib/wms/data/coupon-templates/*.xlsx",
      ],
    },
  },
};
export default nextConfig;
