/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/wms/**": [
        "./lib/wms/data/hanjin-template-static/*.xlsx",
        "./lib/wms/data/discontinue-templates/*.xlsx",
        "./lib/wms/data/discontinue-templates/*.pdf",
        "./lib/wms/data/coupon-templates/*.xlsx",
        "./lib/wms/templates/Report_Issue_Reorder.xlsx",
        "./lib/wms/templates/Coupang_Advertising_Products.xlsx",
        "./lib/wms/data/weekly-advertising-option-ids.json",
      ],
    },
  },
};
export default nextConfig;
