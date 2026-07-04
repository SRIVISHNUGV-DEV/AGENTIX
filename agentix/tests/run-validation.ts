#!/usr/bin/env node

const { execSync } = require("child_process");
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");

const ROOT = process.cwd();
const REPORT_DIR = join(ROOT, "tests", "reports");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");

if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });

console.log("╔══════════════════════════════════════════════════════════════════════╗");
console.log("║           AGENTIX V1 — RELEASE VALIDATION SUITE                    ║");
console.log("║           Running complete GO / NO-GO validation                   ║");
console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

const suites = [
  { id: "01", name: "Installation Tests", file: "01-installation.test.ts" },
  { id: "03", name: "Frontend ↔ Backend Tests", file: "03-frontend-backend.test.ts" },
  { id: "04", name: "Backend / Service Tests", file: "04-backend-services.test.ts" },
  { id: "06", name: "SQLite Tests", file: "06-sqlite.test.ts" },
  { id: "07", name: "Merkle Tree Tests", file: "07-merkle-tree.test.ts" },
  { id: "10", name: "Wallet Tests", file: "10-wallets.test.ts" },
  { id: "11", name: "Session Tests", file: "11-sessions.test.ts" },
  { id: "12", name: "Credential Tests", file: "12-credentials.test.ts" },
  { id: "13", name: "Organization Tests", file: "13-organizations.test.ts" },
  { id: "14", name: "Event Bus Tests", file: "14-eventbus.test.ts" },
  { id: "15", name: "AI Harness Tests", file: "15-ai-harness.test.ts" },
  { id: "16", name: "Tool Tests", file: "16-tools.test.ts" },
  { id: "17", name: "Diagnostics Tests", file: "17-diagnostics.test.ts" },
  { id: "18", name: "Backup Tests", file: "18-backups.test.ts" },
  { id: "20", name: "E2E User Flow Tests", file: "20-e2e-user-flow.test.ts" },
  { id: "21", name: "Chaos Engineering Tests", file: "21-chaos.test.ts" },
  { id: "22", name: "Performance Tests", file: "22-performance.test.ts" },
  { id: "23", name: "Security Tests", file: "23-security.test.ts" },
  { id: "24", name: "Production Readiness Tests", file: "24-production-readiness.test.ts" },
];

const results = [];
let totalPassed = 0;
let totalFailed = 0;
let totalTests = 0;

for (const suite of suites) {
  const filePath = join(ROOT, "tests", suite.file);
  if (!existsSync(filePath)) {
    results.push({ ...suite, status: "SKIP", passed: 0, failed: 0, total: 0, error: "File not found" });
    continue;
  }

  console.log(`\n┌─── ${suite.name} (${suite.id}) ───`);

  try {
    const output = execSync(
      `npx vitest run tests/${suite.file} --reporter=verbose --no-color 2>&1`,
      { cwd: ROOT, timeout: 120000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    const passed = (output.match(/ ✓ /g) || []).length;
    const failed = (output.match(/ ✗ /g) || []).length;
    const status = failed > 0 ? "FAIL" : "PASS";

    results.push({ ...suite, status, passed, failed, total: passed + failed });
    totalPassed += passed;
    totalFailed += failed;
    totalTests += passed + failed;

    console.log(`│  Status: ${status} | Passed: ${passed} | Failed: ${failed}`);
  } catch (e: any) {
    const output = (e.stdout || "") + (e.stderr || "");
    const passed = (output.match(/ ✓ /g) || []).length;
    const failed = (output.match(/ ✗ /g) || []).length || 1;

    results.push({ ...suite, status: "FAIL", passed, failed, total: passed + failed, error: e.message?.slice(0, 100) });
    totalPassed += passed;
    totalFailed += failed;
    totalTests += passed + failed;

    console.log(`│  Status: FAIL | Passed: ${passed} | Failed: ${failed}`);
  }
  console.log("└───");
}

// Generate report
const report = [
  "# AGENTIX V1 — RELEASE VALIDATION REPORT",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Test Results",
  "",
  "| # | Suite | Status | Passed | Failed | Total |",
  "|---|-------|--------|--------|--------|-------|",
  ...results.map((r) => `| ${r.id} | ${r.name} | ${r.status} | ${r.passed} | ${r.failed} | ${r.total} |`),
  "",
  "## Summary",
  "",
  `- **Total Tests**: ${totalTests}`,
  `- **Passed**: ${totalPassed}`,
  `- **Failed**: ${totalFailed}`,
  `- **Suites**: ${results.length}`,
  `- **Pass Rate**: ${totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0}%`,
  "",
  "## GO / NO-GO Verdict",
  "",
  totalFailed === 0
    ? "## ✅ VERDICT: GO — AgentIX V1 is production ready"
    : `## ❌ VERDICT: NO-GO — ${totalFailed} test(s) failed. Fix before release.`,
  "",
  "## Critical Criteria",
  "",
  "| Criterion | Status |",
  "|-----------|--------|",
  `| 100% onboarding success | ${results.find(r => r.id === "03")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
  `| All services operational | ${results.find(r => r.id === "04")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
  `| Database integrity | ${results.find(r => r.id === "06")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
  `| Merkle trees functional | ${results.find(r => r.id === "07")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
  `| Event bus operational | ${results.find(r => r.id === "14")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
  `| All tools functional | ${results.find(r => r.id === "16")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
  `| Security checks pass | ${results.find(r => r.id === "23")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
  `| Performance acceptable | ${results.find(r => r.id === "22")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
  `| Chaos resilience | ${results.find(r => r.id === "21")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
  `| E2E user flow works | ${results.find(r => r.id === "20")?.status === "PASS" ? "✅ PASS" : "❌ FAIL"} |`,
].join("\n");

const reportPath = join(REPORT_DIR, `RELEASE-REPORT-${TIMESTAMP}.md`);
writeFileSync(reportPath, report);

console.log("\n" + "=".repeat(70));
console.log("         AGENTIX V1 — FINAL RELEASE VALIDATION");
console.log("=".repeat(70));
console.log(`  Total Tests:  ${totalTests}`);
console.log(`  Passed:       ${totalPassed}`);
console.log(`  Failed:       ${totalFailed}`);
console.log(`  Pass Rate:    ${totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0}%`);
console.log("=".repeat(70));

if (totalFailed === 0) {
  console.log("\n  ╔══════════════════════════════════════════════╗");
  console.log("  ║           VERDICT: GO                       ║");
  console.log("  ║     AgentIX V1 is production ready           ║");
  console.log("  ╚══════════════════════════════════════════════╝\n");
  process.exit(0);
} else {
  console.log("\n  ╔══════════════════════════════════════════════╗");
  console.log("  ║           VERDICT: NO-GO                     ║");
  console.log("  ║     Fix failing tests before release         ║");
  console.log("  ╚══════════════════════════════════════════════╝\n");

  for (const r of results.filter((r) => r.status === "FAIL")) {
    console.log(`  ✗ ${r.name}: ${r.error || `${r.failed} tests failed`}`);
  }
  console.log("");
  process.exit(1);
}
