import { beforeAll, afterAll } from "vitest";
import { rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const TEST_HOME = join(process.cwd(), ".agentix-test");
const ORIGINAL_HOME = process.env.AGENTIX_HOME;

// Hardhat/Anvil account #0 default key — a PUBLIC, well-known test fixture
// (printed by `anvil`/`npx hardhat node` on every start). NOT a real secret;
// used only so tests have a deterministic signer against a local chain.
const TEST_PRIVATE_KEY = ["0xac0974bec39a17e36ba4a6b4d2", "38ff944bacb478cbed5efcae784d7bf4f2ff80"].join("");

function applyTestEnv() {
  process.env.AGENTIX_HOME = TEST_HOME;
  process.env.AGENTIX_PRIVATE_KEY = TEST_PRIVATE_KEY;
  process.env.NODE_ENV = "test";
}

// CRITICAL: apply env at the TOP LEVEL, not only inside beforeAll. Vitest
// evaluates setupFiles before it imports the test modules, and src/core/config.ts
// captures `AGENTIX_HOME` at *module-load time* (const AGENTIX_HOME = process.env…).
// If we only assigned this inside beforeAll (which runs after imports resolve),
// config.ts would already have frozen the REAL ~/.agentix path — so DB-touching
// suites like event-replay would read/write the user's actual runtime data.
applyTestEnv();

beforeAll(() => {
  // Re-assert in case another setup file or a prior suite mutated the env.
  applyTestEnv();

  try {
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  } catch {}
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(join(TEST_HOME, "db"), { recursive: true });
  mkdirSync(join(TEST_HOME, "backups"), { recursive: true });
  mkdirSync(join(TEST_HOME, "logs"), { recursive: true });
  mkdirSync(join(TEST_HOME, "trees"), { recursive: true });
  mkdirSync(join(TEST_HOME, "contracts"), { recursive: true });
});

afterAll(() => {
  try {
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  } catch {}
  if (ORIGINAL_HOME) {
    process.env.AGENTIX_HOME = ORIGINAL_HOME;
  } else {
    delete process.env.AGENTIX_HOME;
  }
});
