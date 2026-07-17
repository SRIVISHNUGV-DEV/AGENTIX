/** @type {import('next').NextConfig} */
const path = require("path");
const os = require("os");
const fs = require("fs");

// Resolve the API server's actual base URL. The runtime server writes its live
// port to AGENTIX_HOME/runtime.json (it picks a free port near 3001 at startup),
// so the dashboard reads that here and proxies same-origin /api/* to it. This is
// what makes the whole stack port-agnostic: the browser only ever talks to the
// dashboard's own origin, and Next forwards /api to wherever the backend landed.
function resolveApiTarget() {
  // Explicit override always wins (remote API, custom host, CI, etc.).
  if (process.env.AGENTIX_API_URL) return process.env.AGENTIX_API_URL;

  const home = process.env.AGENTIX_HOME || path.join(os.homedir(), ".agentix");
  const manifestPath = path.join(home, "runtime.json");
  try {
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (manifest.apiPort) {
        const host = manifest.host || "127.0.0.1";
        return `http://${host}:${manifest.apiPort}`;
      }
    }
  } catch {
    /* fall through to default */
  }
  // Backend not started yet or manifest unreadable — fall back to the preferred
  // port. If the backend later lands elsewhere, restarting `next dev` re-reads
  // the manifest. (rewrites() runs at server start; see note below.)
  const preferred = process.env.AGENTIX_API_PORT || "3001";
  return `http://127.0.0.1:${preferred}`;
}

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
  async rewrites() {
    const target = resolveApiTarget();
    return [
      {
        source: "/api/:path*",
        destination: `${target}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
