import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";

const TEST_DB_DIR = join(process.cwd(), ".agentix-test-db");

describe("1. Installation Tests", () => {
  beforeAll(() => {
    if (existsSync(TEST_DB_DIR)) rmSync(TEST_DB_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_DB_DIR)) rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it("AGENTIX_HOME is set", () => {
    expect(process.env.AGENTIX_HOME).toBeDefined();
    expect(process.env.AGENTIX_HOME).toContain(".agentix-test");
  });

  it("Required directories exist", () => {
    const home = process.env.AGENTIX_HOME!;
    expect(existsSync(home)).toBe(true);
    expect(existsSync(join(home, "db"))).toBe(true);
    expect(existsSync(join(home, "backups"))).toBe(true);
    expect(existsSync(join(home, "logs"))).toBe(true);
  });

  it("better-sqlite3 is importable", async () => {
    const db = await import("better-sqlite3");
    expect(db).toBeDefined();
    expect(typeof db.default).toBe("function");
  });

  it("ethers is importable", async () => {
    const ethers = await import("ethers");
    expect(ethers).toBeDefined();
    expect(ethers.utils).toBeDefined();
  });

  it("circomlibjs is importable", async () => {
    const circom = await import("circomlibjs");
    expect(circom).toBeDefined();
    expect(typeof circom.buildPoseidon).toBe("function");
  });

  it("commander is importable", async () => {
    const { Command } = await import("commander");
    expect(Command).toBeDefined();
  });

  it("zod is importable", async () => {
    const z = await import("zod");
    expect(z).toBeDefined();
    expect(typeof z.z.string).toBe("function");
  });

  it("TypeScript source files are accessible", () => {
    const srcDir = join(process.cwd(), "src");
    expect(existsSync(join(srcDir, "index.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "core", "database.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "core", "config.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "runtime", "server.ts"))).toBe(true);
  });

  it("Shared packages are accessible", () => {
    expect(existsSync(join(process.cwd(), "packages", "shared", "types", "index.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "packages", "shared", "constants", "index.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "packages", "shared", "utils", "index.ts"))).toBe(true);
  });

  it("Smart contract ABIs exist", () => {
    const abisDir = join(process.cwd(), "..", "contracts", "abis");
    expect(existsSync(join(abisDir, "AgentWallet.json"))).toBe(true);
    expect(existsSync(join(abisDir, "SessionManager.json"))).toBe(true);
    expect(existsSync(join(abisDir, "CredentialRegistry.json"))).toBe(true);
    expect(existsSync(join(abisDir, "OrganizationRegistry.json"))).toBe(true);
    expect(existsSync(join(abisDir, "Groth16Verifier.json"))).toBe(true);
  });
});
