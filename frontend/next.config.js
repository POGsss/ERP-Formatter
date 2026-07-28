/** @type {import('next').NextConfig} */
const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:8000";
const isStaticExport = process.env.NEXT_OUTPUT === "export";

const nextConfig = isStaticExport
  ? {
      output: "export",
      images: { unoptimized: true },
      trailingSlash: true,
    }
  : {
      async rewrites() {
        return [
          {
            source: "/api/:path*",
            destination: `${apiBaseUrl}/api/:path*`,
          },
        ];
      },
    };

module.exports = nextConfig;
