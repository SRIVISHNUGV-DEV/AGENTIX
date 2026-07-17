import { generateId } from "../../shared/utils";
import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import type { OrganizationRequest } from "../../shared/types";
import { ethers } from "ethers";

const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 10;
const REQUEST_EXPIRY = 86400;

const requestTimestamps: Map<string, number[]> = new Map();

function checkRateLimit(address: string): boolean {
  const now = Date.now();
  const timestamps = requestTimestamps.get(address) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  requestTimestamps.set(address, recent);
  return true;
}

export class AuthorityService {
  private bus = getEventBus();

  async submitRequest(name: string, ownerAddress: string, eip712Signature: string): Promise<{ success: boolean; requestId?: string; error?: string }> {
    if (!checkRateLimit(ownerAddress)) {
      return { success: false, error: "Rate limit exceeded. Try again later." };
    }

    const existing = runSingleCamel<any>(
      "SELECT id FROM organization_requests WHERE owner_address = ? AND status = 'pending'",
      ownerAddress
    );
    if (existing) {
      return { success: false, error: "You already have a pending request." };
    }

    const requestId = `req_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);

    // Try with expires_at first; if column doesn't exist (old schema), insert without it
    try {
      runExecute(
        "INSERT INTO organization_requests (id, name, owner_address, eip712_signature, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
        requestId, name, ownerAddress, eip712Signature, now, now + REQUEST_EXPIRY
      );
    } catch {
      runExecute(
        "INSERT INTO organization_requests (id, name, owner_address, eip712_signature, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
        requestId, name, ownerAddress, eip712Signature, now
      );
    }

    await this.bus.emit({ type: "OrganizationRequested", data: { requestId, name } });

    return { success: true, requestId };
  }

  listPending(): OrganizationRequest[] {
    const now = Math.floor(Date.now() / 1000);
    try {
      runExecute("UPDATE organization_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < ?", now);
    } catch {
      // expires_at column may not exist in old schema — skip expiry check
    }
    return runQueryCamel<OrganizationRequest>(
      "SELECT * FROM organization_requests WHERE status = 'pending' ORDER BY created_at ASC"
    );
  }

  async approveRequest(requestId: string): Promise<{ success: boolean; organizationId?: string; txHash?: string; error?: string }> {
    const request = runSingleCamel<any>("SELECT * FROM organization_requests WHERE id = ?", requestId);
    if (!request) return { success: false, error: "Request not found" };
    if (request.status !== "pending") return { success: false, error: `Request is ${request.status}` };

    const organizationId = `org_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);

    // Generate bytes32 orgId for onchain registration
    const onchainOrgId = ethers.keccak256(ethers.toUtf8Bytes(`${request.name}:${request.ownerAddress}:${now}`));

    // Register onchain via OrganizationRegistry (deployer/owner calls)
    let txHash = '';
    let credentialAnchor = '';
    try {
      const { getSigner } = await import("../../../src/core/provider");
      const { getAbiByName } = await import("../../../src/contracts");
      const { getProxyGuard } = await import("../../../src/core/proxy-guard");
      const guard = getProxyGuard();
      const signer = getSigner();
      const orgRegAddr = guard.getProxyAddress("OrganizationRegistry");
      const abi = getAbiByName("OrganizationRegistry");
      const contract = new ethers.Contract(orgRegAddr, abi, signer);
      const tx = await contract.registerOrganization(onchainOrgId, request.name, request.ownerAddress);
      const receipt = await tx.wait();
      txHash = receipt.hash;

      // Parse OrgAnchorDeployed event to get the credential anchor address
      for (const log of receipt.logs) {
        try {
          const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === "OrgAnchorDeployed") {
            credentialAnchor = parsed.args.anchor;
            break;
          }
        } catch {}
      }
    } catch (e: any) {
      console.error("Onchain org registration failed:", e.message);
      // Continue with local-only registration if onchain fails
    }

    runExecute(
      "INSERT INTO organizations (id, name, owner_address, active, created_at, credential_anchor, org_numeric_id) VALUES (?, ?, ?, 1, ?, ?, ?)",
      organizationId, request.name, request.ownerAddress, now, credentialAnchor || null, 0
    );

    runExecute(
      "UPDATE organization_requests SET status = 'approved' WHERE id = ?",
      requestId
    );

    this.bus.emit({ type: "OrganizationApproved", data: { requestId, txHash } }).catch(() => {});
    this.bus.emit({ type: "OrganizationCreated", data: { organizationId, name: request.name, txHash, credentialAnchor } }).catch(() => {});

    // Persist events to DB
    try {
      runExecute(
        "INSERT INTO events (event_type, data, tx_hash, created_at) VALUES (?, ?, ?, ?)",
        "OrganizationCreated",
        JSON.stringify({ organizationId, name: request.name, onchainOrgId, txHash, credentialAnchor }),
        txHash || null,
        now
      );
    } catch {}

    return { success: true, organizationId, txHash };
  }

  rejectRequest(requestId: string, reason?: string): { success: boolean; error?: string } {
    const request = runSingleCamel<any>("SELECT * FROM organization_requests WHERE id = ?", requestId);
    if (!request) return { success: false, error: "Request not found" };
    if (request.status !== "pending") return { success: false, error: `Request is ${request.status}` };

    runExecute("UPDATE organization_requests SET status = 'rejected' WHERE id = ?", requestId);
    return { success: true };
  }

  getRequest(requestId: string): OrganizationRequest | undefined {
    return runSingleCamel<OrganizationRequest>("SELECT * FROM organization_requests WHERE id = ?", requestId);
  }
}

let _authority: AuthorityService | null = null;
export function getAuthorityService(): AuthorityService {
  if (!_authority) _authority = new AuthorityService();
  return _authority;
}
