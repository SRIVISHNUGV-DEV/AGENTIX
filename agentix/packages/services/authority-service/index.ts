import { generateId } from "../../shared/utils";
import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import type { OrganizationRequest } from "../../shared/types";
import { ethers } from "ethers";

const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 10;
const REQUEST_EXPIRY = 86400;

const requestTimestamps: Map<string, number[]> = new Map();

/**
 * Sliding-window rate limiter for org-request submissions, 10 requests per 60 s per address.
 * WHY: submitting a request is cheap and unauthenticated, so without a limiter one address could flood the pending queue.
 * @param address Owner address the window is keyed on; case-sensitive, so differently-cased spellings of the same address get separate windows.
 * @returns True when the request is within budget (and the attempt is recorded); false when the window is full.
 * @throws Never throws.
 * Maps to: internal — AuthorityService.submitRequest (only caller).
 * Side effects: mutates the in-memory requestTimestamps map. In-memory only: limits reset on restart and are not shared across processes; entries for idle addresses are never pruned.
 */
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

  /**
   * Records a new organization request as pending and notifies listeners.
   * WHY: the intake step of org onboarding — a request must exist (and be unique per owner) before an admin can approve it into an on-chain org.
   * @param name Requested organization name; stored verbatim, no validation or uniqueness check.
   * @param ownerAddress Claimed owner address; rate-limited and uniqueness-checked, but the EIP-712 signature is stored, never verified (see security note).
   * @param eip712Signature Signature bytes as supplied; persisted without verification.
   * @returns `{ success, requestId }` on acceptance; `{ success: false, error }` when rate-limited or a pending request already exists for the owner.
   * @throws Throws on DB errors (the insert fallback catches only a missing expires_at column).
   * Maps to: event OrganizationRequested; internal — AuthorityService.approveRequest (the request this intake feeds).
   * Side effects: inserts a row into organization_requests (expires in 24 h) and emits OrganizationRequested.
   * Security note: the signature is never verified against ownerAddress, so anyone can file a request claiming any address; approval must not treat the stored signature as proof of ownership.
   */
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

  /**
   * Returns pending organization requests, expiring stale ones first.
   * WHY: the admin queue — approvers should only see requests that are still actionable.
   * @returns Pending requests oldest first; empty array when none are pending.
   * @throws Throws on DB errors (the expiry UPDATE failure is swallowed for old schemas without expires_at).
   * Maps to: internal — AuthorityService.approveRequest / rejectRequest (admin review queue).
   * Side effects: flips expired pending rows to 'expired' (best-effort) and reads the queue.
   */
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

  /**
   * Approves a pending request: registers the org on-chain when possible, then records it locally and emits creation events.
   * WHY: the one action that turns a request into a usable organization — on-chain registration mints the org anchor the credential system trusts.
   * @param requestId Id from submitRequest(); must be pending — already-approved/rejected/expired requests are refused.
   * @returns `{ success, organizationId, txHash }`; `{ success: false, error }` when missing or not pending. txHash is '' when the on-chain call failed and registration fell back to local-only.
   * @throws Throws on DB errors; on-chain failures are caught, logged, and swallowed (local-only registration continues).
   * Maps to: contract OrganizationRegistry.registerOrganization; event OrganizationApproved, OrganizationCreated.
   * Side effects: on-chain registerOrganization tx (signer pays gas), inserts into organizations and events, marks the request approved. NOT atomic: a crash between the tx and the local insert leaves an on-chain org with no local row; org_numeric_id is always stored as 0.
   * Security note: this method performs no auth check itself — whoever can call it can create orgs, so the caller must be an authorized admin. The on-chain org id is keccak256(name:owner:now), so same name/owner approved twice within one second collides.
   */
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

  /**
   * Rejects a pending organization request.
   * WHY: the admin's no — closes the request so the owner can file a fresh one.
   * @param requestId Id from submitRequest(); must be pending.
   * @param reason Rejection reason as supplied — currently accepted but never stored or surfaced to the requester.
   * @returns `{ success: true }`, or `{ success: false, error }` when missing or not pending.
   * @throws Throws on DB errors.
   * Maps to: internal — AuthorityService.listPending (removes the request from the admin queue); no event is emitted.
   * Side effects: updates the request row to 'rejected'. No event is emitted and the reason is dropped.
   */
  rejectRequest(requestId: string, reason?: string): { success: boolean; error?: string } {
    const request = runSingleCamel<any>("SELECT * FROM organization_requests WHERE id = ?", requestId);
    if (!request) return { success: false, error: "Request not found" };
    if (request.status !== "pending") return { success: false, error: `Request is ${request.status}` };

    runExecute("UPDATE organization_requests SET status = 'rejected' WHERE id = ?", requestId);
    return { success: true };
  }

  /**
   * Fetches one organization request by id, regardless of status.
   * WHY: the read path for approval/rejection flows and for showing a requester their request state.
   * @returns The request, or undefined when no row matches.
   * @throws Throws on DB errors.
   * Maps to: internal — AuthorityService.approveRequest / rejectRequest (pre-check read).
   * Side effects: none (read-only).
   */
  getRequest(requestId: string): OrganizationRequest | undefined {
    return runSingleCamel<OrganizationRequest>("SELECT * FROM organization_requests WHERE id = ?", requestId);
  }
}

let _authority: AuthorityService | null = null;
/**
 * Returns the process-wide singleton AuthorityService.
 * WHY: one service per process — the rate-limit map must be shared by all submitters.
 * @returns The singleton instance.
 * @throws Never throws.
 * Maps to: internal — AuthorityService (module-level accessor).
 * Side effects: creates the singleton on first call.
 */
export function getAuthorityService(): AuthorityService {
  if (!_authority) _authority = new AuthorityService();
  return _authority;
}
