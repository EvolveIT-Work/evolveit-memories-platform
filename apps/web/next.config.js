/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@evolveit/shared", "@evolveit/redeem"],
  experimental: {
    serverComponentsExternalPackages: ["argon2"],
  },
};

module.exports = nextConfig;
