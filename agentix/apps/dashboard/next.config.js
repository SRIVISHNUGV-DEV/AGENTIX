/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" requires symlink creation during `next build`'s copyTracedFiles
  // step, which fails on Windows without Developer Mode or admin rights
  // (EPERM: operation not permitted, symlink). The dev server and a normal
  // `next build` work fine without it, and the dashboard is always served
  // from the project's node_modules anyway — so disable standalone for
  // cross-platform compatibility.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ethers5: require.resolve("ethers"),
    };
    return config;
  },
};

module.exports = nextConfig;
