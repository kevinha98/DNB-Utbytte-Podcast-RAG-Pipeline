/** @type {import('next').NextConfig} */
// GitHub Pages — no basePath needed (deployed at repo root)

const nextConfig = {
  output: "export",
  basePath: "",
  assetPrefix: "",
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "https://utbytte-backend-production.up.railway.app",
  },
};

module.exports = nextConfig;
