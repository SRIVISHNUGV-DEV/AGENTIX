import { build } from "esbuild";
import { rmSync, mkdirSync, existsSync, cpSync, writeFileSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), "..");
const DIST = join(ROOT, "dist-publish");

async function main() {
  console.log("Cleaning dist-publish/...");
  if (existsSync(DIST)) rmSync(DIST, { recursive: true });
  mkdirSync(DIST, { recursive: true });

  const sharedConfig = {
    bundle: true,
    platform: "node" as const,
    target: "node18" as const,
    format: "cjs" as const,
    external: ["better-sqlite3"],
    define: { "process.env.NODE_ENV": '"production"' },
    sourcemap: false,
    minify: false,
  };

  console.log("Bundling src/index.ts (CLI)...");
  await build({
    ...sharedConfig,
    entryPoints: [join(ROOT, "src/index.ts")],
    outfile: join(DIST, "index.js"),
    banner: { js: "#!/usr/bin/env node" },
  });

  console.log("Bundling src/mcp/server.ts (MCP server)...");
  await build({
    ...sharedConfig,
    entryPoints: [join(ROOT, "src/mcp/server.ts")],
    outfile: join(DIST, "mcp.js"),
  });

  console.log("Bundling src/runtime/server.ts (API server)...");
  await build({
    ...sharedConfig,
    entryPoints: [join(ROOT, "src/runtime/server.ts")],
    outfile: join(DIST, "server.js"),
  });

  // Copy bin scripts
  console.log("Copying bin scripts...");
  cpSync(join(ROOT, "bin"), join(DIST, "bin"), { recursive: true });

  // Copy ZK circuit artifacts so the published package can prove standalone.
  // zk-prover resolves circuits/ by walking up from the bundle, so shipping them
  // at dist-publish/circuits/ makes proving work with zero extra setup.
  console.log("Copying ZK circuit artifacts...");
  const CIRCUITS_SRC = join(ROOT, "..", "circuits");
  const CIRCUITS_DST = join(DIST, "circuits");
  const artifactPaths = [
    "artifacts.manifest.json",
    join("prover", "credential_V1_final.zkey"),
    join("prover", "credential_V1_js", "credential_V1.wasm"),
    join("build", "verification_key.json"),
  ];
  let copied = 0;
  for (const rel of artifactPaths) {
    const src = join(CIRCUITS_SRC, rel);
    const dst = join(CIRCUITS_DST, rel);
    if (!existsSync(src)) {
      console.warn(`  ⚠ missing artifact, skipped: ${rel}`);
      continue;
    }
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
    copied++;
  }
  if (copied < artifactPaths.length) {
    // Fail hard: a package shipped without its circuit artifacts silently loses
    // ZK proving. Better to block the publish than to ship a broken release.
    // Set AGENTIX_ALLOW_PARTIAL_BUNDLE=1 to override (e.g. a CLI-only build).
    const msg =
      `Only ${copied}/${artifactPaths.length} circuit artifacts copied — ` +
      `the published package could NOT generate ZK proofs. Aborting bundle. ` +
      `Set AGENTIX_ALLOW_PARTIAL_BUNDLE=1 to override.`;
    if (process.env.AGENTIX_ALLOW_PARTIAL_BUNDLE === "1") {
      console.warn(`  ⚠ ${msg}`);
    } else {
      throw new Error(msg);
    }
  } else {
    console.log(`  ✓ ${copied} circuit artifacts bundled`);
  }

  // Generate publish package.json
  console.log("Generating publish package.json...");
  const publishPkg = {
    name: "agentix",
    version: "1.0.0",
    description: "Local-first AI agent execution engine. Smart wallets, sessions, credentials, and risk-bound execution for AI agents on Base Sepolia.",
    bin: {
      agentix: "./bin/agentix",
      "agentix-mcp": "./bin/agentix-mcp",
    },
    files: ["index.js", "mcp.js", "server.js", "bin/", "circuits/"],
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
    keywords: ["ai-agent", "wallet", "credential", "web3", "erc4337", "zkp", "mcp", "agent-security"],
  };

  writeFileSync(join(DIST, "package.json"), JSON.stringify(publishPkg, null, 2));

  // Fix bin scripts to point to bundled files. Wrap the require so a missing /
  // unbuilt native dependency (better-sqlite3 is the only native one) surfaces
  // an actionable message instead of a raw stack trace — keeping the CLI usable
  // out of the box even when a prebuilt binary didn't land.
  const shim = (entry: string) => `#!/usr/bin/env node
try {
  require('${entry}');
} catch (e) {
  if (e && (e.code === 'MODULE_NOT_FOUND' || /better-sqlite3|Could not locate the bindings/.test(String(e.message)))) {
    console.error('\\n  AgentIX could not load a required module (' + (e.message || e) + ').');
    console.error('  Fix: reinstall dependencies with  npm install -g agentix  (needs a C toolchain for better-sqlite3).\\n');
    process.exit(1);
  }
  throw e;
}
`;
  writeFileSync(join(DIST, "bin", "agentix"), shim("../index.js"));
  writeFileSync(join(DIST, "bin", "agentix-mcp"), shim("../mcp.js"));

  // Write README
  writeFileSync(join(DIST, "README.md"), `# agentix

Local-first AI agent execution engine on Base Sepolia.

## Quick Start

\`\`\`bash
npx agentix setup
\`\`\`

The setup wizard verifies your environment, creates local storage, configures an
RPC endpoint (public by default — no key needed, optional provider key for higher
limits), and auto-detects your AI harnesses (Claude Code, Cursor, Copilot, ...),
wiring the AgentIX MCP server into each so tools work immediately.

## What You Get

- **ERC-4337 Smart Wallet** — deterministic, session-key controlled
- **Lightweight Sessions** — daily spend limits, daily tx limits, expiry
- **Credentials** — Merkle-tree based, org-issued, ZK-provable
- **Risk-Bound Execution** — every action validated, simulated, risk-scored, explained
- **Owner Policy** — set spending limits once, agent operates freely within bounds
- **MCP Integration** — 69 tools for Claude Code, Cursor, Copilot, MimoCode, OpenCode

## Commands

\`\`\`bash
agentix setup                   # Interactive wizard (RPC + MCP auto-wiring)
agentix connect                 # Detect harnesses & wire in AgentIX MCP tools
agentix init                    # Initialize local runtime (non-interactive)
agentix doctor                  # Full system diagnostics (12 points)
agentix health                  # Quick health check
agentix wallet create           # Create agent wallet
agentix session create          # Create lightweight session
agentix cred issue              # Issue credential
agentix fund --amount 10        # Get fiat on-ramp options
agentix protocol                # Protocol documentation
\`\`\`

## MCP (for AI Agents)

\`agentix setup\` and \`agentix connect\` auto-wire the MCP server into every
detected harness. To start it manually:

\`\`\`bash
npx agentix-mcp
\`\`\`

## Architecture

Local-first. No cloud.
SQLite at ~/.agentix/db/. Config at ~/.agentix/config/.
Every action goes through: Parse -> Validate -> Resolve -> Policy -> Simulate -> Risk Score -> Explain -> Execute.

Set \`AGENTIX_HOME\` to relocate the data directory (defaults to ~/.agentix).

## Security

The optional API server (used by the dashboard) binds to 127.0.0.1 only and has
**no authentication** — it trusts every local caller. Do not expose port 3001 to
a network. Any local process or browser page can reach it and trigger writes.
Private keys, when configured, are read from the \`AGENTIX_PRIVATE_KEY\` / \`PRIVATE_KEY\`
environment variables — never commit them.

### Known advisories

\`snarkjs\` (ZK proving) pulls transitive dev-tooling deps (\`bfj\`/\`jsonpath\`/\`underscore\`,
\`ws\`, \`@ethersproject\` v5) with published DoS-class advisories. These are not reachable
from the proving path used at runtime (\`groth16.fullProve\`); the top-level \`ethers\` is v6.
They resolve once upstream snarkjs updates its dependency tree.
`);

  // Stats
  const indexSize = statSync(join(DIST, "index.js")).size;
  const mcpSize = statSync(join(DIST, "mcp.js")).size;
  const serverSize = statSync(join(DIST, "server.js")).size;
  const totalMB = ((indexSize + mcpSize + serverSize) / 1024 / 1024).toFixed(1);

  console.log(`\nDone! dist-publish/ ready for npm publish.`);
  console.log(`  CLI:      ${(indexSize / 1024).toFixed(0)} KB`);
  console.log(`  MCP:      ${(mcpSize / 1024).toFixed(0)} KB`);
  console.log(`  Server:   ${(serverSize / 1024).toFixed(0)} KB`);
  console.log(`  Total:    ${totalMB} MB`);
  console.log(`  Run: cd dist-publish && npm publish`);
  console.log(`  Users: npx agentix init`);
}

main().catch((e) => { console.error(e); process.exit(1); });
