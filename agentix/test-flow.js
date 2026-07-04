const { execSync } = require("child_process");

const CLI = "node dist/src/index.js";
const ORG = "0x0000000000000000000000000000000000000000000000000000000000000001";

function cli(cmd) {
  try {
    let out = execSync(`${CLI} ${cmd}`, {
      encoding: "utf-8",
      timeout: 60000,
      env: process.env,
      cwd: __dirname,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out.replace(/\x1b\[[0-9;]*m/g, "");
  } catch (e) {
    return (e.stdout || e.message).replace(/\x1b\[[0-9;]*m/g, "");
  }
}

function extract(text, key) {
  const m = text.match(new RegExp(`${key}:\\s*(.+)`));
  return m ? m[1].trim() : null;
}

async function main() {
  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}`); failed++; }
  }

  console.log("\n=== 1. ISSUE CREDENTIAL ===");
  const cred1 = cli(`cred issue --org ${ORG} --agent 1 --permissions 255 --expiry 86400`);
  const cid1 = extract(cred1, "credentialId");
  const null1 = extract(cred1, "nullifier");
  const sec1 = extract(cred1, "secret");
  check("Issue credential for agent 1", !!cid1);
  console.log(`  Credential: ${cid1?.slice(0, 20)}...`);
  console.log(`  Nullifier: ${null1?.slice(0, 20)}...`);
  console.log(`  Secret: ${sec1?.slice(0, 20)}...`);

  console.log("\n=== 2. TREE STATUS ===");
  const tree1 = cli(`tree status ${ORG}`);
  const leaves = extract(tree1, "activeLeafCount");
  check("Tree has 1 leaf", leaves === "1");

  console.log("\n=== 3. GENERATE PROOF ===");
  const proof1 = cli(`proof generate --org ${ORG} --agent 1 --nullifier ${null1} --secret ${sec1} --wallet 0xE2e34Dceb7dAFCd63257C5cbE69Fcb06571ADAcC --expiry 3600`);
  const ph1 = extract(proof1, "proofHash");
  check("Generate proof", !!ph1);
  console.log(`  Proof Hash: ${ph1?.slice(0, 20)}...`);

  console.log("\n=== 4. VERIFY PROOF ===");
  const v1 = cli(`proof verify --hash ${ph1}`);
  check("Verify proof (should be valid)", v1.includes("valid"));

  console.log("\n=== 5. ISSUE SECOND CREDENTIAL ===");
  const cred2 = cli(`cred issue --org ${ORG} --agent 2 --permissions 128 --expiry 172800`);
  check("Issue credential for agent 2", !!extract(cred2, "credentialId"));

  console.log("\n=== 6. VERIFY ORIGINAL PROOF (root changed) ===");
  const v2 = cli(`proof verify --hash ${ph1}`);
  check("Old proof invalid after root change", v2.includes("false") || v2.includes("invalid"));

  console.log("\n=== 7. LIST CREDENTIALS ===");
  const list1 = cli(`cred list --org ${ORG}`);
  check("List shows credentials", list1.includes("credentialId") || list1.includes("Agent"));

  console.log("\n=== 8. REVOKE CREDENTIAL ===");
  const rev1 = cli(`cred revoke --org ${ORG} --agent 2`);
  check("Revoke credential", !!extract(rev1, "revokedRoot"));

  console.log("\n=== 9. BACKUP ===");
  const bk1 = cli(`backup create --description "E2E test"`);
  check("Create backup", !!extract(bk1, "backupId"));

  console.log("\n=== 10. HEALTH CHECK ===");
  const hp1 = cli(`doctor`);
  check("Health check has PASS", hp1.includes("PASS"));

  console.log("\n=== 11. PROTOCOL DOCS ===");
  const doc1 = cli(`protocol trust`);
  check("Protocol docs work", doc1.includes("Trust Boundary"));

  console.log(`\n══════════════════════════════════════════`);
  console.log(`  RESULTS: ${passed} passed / ${failed} failed / ${passed + failed} total`);
  console.log(`══════════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
