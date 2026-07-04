/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ethers5: require.resolve("ethers"),
    };
    return config;
  },
};

module.exports = nextConfig;
