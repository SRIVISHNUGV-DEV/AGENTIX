import { build } from "esbuild";
import { rmSync, mkdirSync, existsSync, cpSync, writeFileSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), "..");
const DIST = join(ROOT, "dist-publish");
const OUT = join(DIST, "index.js");

async function main() {
  console.log("Cleaning dist-publish/...");
  if (existsSync(DIST)) rmSync(DIST, { recursive: true });
  mkdirSync(DIST, { recursive: true });

  console.log("Bundling src/index.ts (CLI + API + MCP + all tools)...");
  await build({
    entryPoints: [join(ROOT, "src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: OUT,
    external: ["better-sqlite3"],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    banner: {
      js: "#!/usr/bin/env node",
    },
    footer: {
      js: "",
    },
    sourcemap: false,
    minify: false,
  });

  console.log("Bundling src/mcp/server.ts (MCP server)...");
  await build({
    entryPoints: [join(ROOT, "src/mcp/server.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: join(DIST, "mcp.js"),
    external: ["better-sqlite3"],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    sourcemap: false,
    minify: false,
  });

  console.log("Bundling src/runtime/server.ts (API server)...");
  await build({
    entryPoints: [join(ROOT, "src/runtime/server.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: join(DIST, "server.js"),
    external: ["better-sqlite3"],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    sourcemap: false,
    minify: false,
  });

  // Copy bin scripts
  console.log("Copying bin scripts...");
  cpSync(join(ROOT, "bin"), join(DIST, "bin"), { recursive: true });

  // Read current package.json and strip workspace/dev fields
  console.log("Generating publish package.json...");
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const publishPkg = {
    name: "agentix",
    version: pkg.version || "1.0.0",
    description: "Local-first AI agent credential protocol runtime. Deploy wallets, create sessions, manage delegations.",
    bin: {
      agentix: "./bin/agentix",
      "agentix-mcp": "./bin/agentix-mcp",
    },
    files: [
      "index.js",
      "mcp.js",
      "server.js",
      "bin/",
    ],
    dependencies: {
      "better-sqlite3": "^11.7.0",
      "@modelcontextprotocol/sdk": "^1.29.0",
      "ethers": "^6.13.4",
      "snarkjs": "^0.7.5",
      "circomlibjs": "^0.1.7",
      "zod": "^3.25.76",
      "commander": "^12.1.0",
    },
    engines: { node: ">=18.0.0" },
    license: "MIT",
    keywords: ["agent", "wallet", "credential", "web3", "erc4337", "zkp"],
    repository: pkg.repository || undefined,
    homepage: pkg.homepage || undefined,
  };

  writeFileSync(join(DIST, "package.json"), JSON.stringify(publishPkg, null, 2));

  // Fix bin scripts to point to bundled files
  const agentixBin = `#!/usr/bin/env node\nrequire('../index.js');`;
  const mcpBin = `#!/usr/bin/env node\nrequire('../mcp.js');`;
  writeFileSync(join(DIST, "bin", "agentix"), agentixBin);
  writeFileSync(join(DIST, "bin", "agentix-mcp"), mcpBin);

  // Stats
  const size = statSync(OUT).size;
  console.log(`\nDone! dist-publish/ ready for npm publish.`);
  console.log(`  CLI bundle: ${(size / 1024).toFixed(0)} KB`);
  console.log(`  Run: cd dist-publish && npm publish`);
  console.log(`  Users: npx agentix init`);
}

main().catch((e) => { console.error(e); process.exit(1); });
