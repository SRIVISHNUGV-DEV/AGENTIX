import { beforeAll, afterAll } from "vitest";
import { rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const TEST_HOME = join(process.cwd(), ".agentix-test");
const ORIGINAL_HOME = process.env.AGENTIX_HOME;

beforeAll(() => {
  process.env.AGENTIX_HOME = TEST_HOME;
  process.env.AGENTIX_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  process.env.NODE_ENV = "test";

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
