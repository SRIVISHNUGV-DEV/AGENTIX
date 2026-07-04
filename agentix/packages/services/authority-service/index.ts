import { generateId } from "../../shared/utils";
import { runExecute, runSingle, runQuery } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import type { OrganizationRequest } from "../../shared/types";

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

    const existing = runSingle<any>(
      "SELECT id FROM organization_requests WHERE owner_address = ? AND status = 'pending'",
      ownerAddress
    );
    if (existing) {
      return { success: false, error: "You already have a pending request." };
    }

    const requestId = `req_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);

    runExecute(
      "INSERT INTO organization_requests (id, name, owner_address, eip712_signature, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
      requestId, name, ownerAddress, eip712Signature, now, now + REQUEST_EXPIRY
    );

    await this.bus.emit({ type: "OrganizationRequested", data: { requestId, name } });

    return { success: true, requestId };
  }

  listPending(): OrganizationRequest[] {
    const now = Math.floor(Date.now() / 1000);
    runExecute("UPDATE organization_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < ?", now);
    return runQuery<OrganizationRequest>(
      "SELECT * FROM organization_requests WHERE status = 'pending' ORDER BY created_at ASC"
    );
  }

  approveRequest(requestId: string): { success: boolean; organizationId?: string; error?: string } {
    const request = runSingle<any>("SELECT * FROM organization_requests WHERE id = ?", requestId);
    if (!request) return { success: false, error: "Request not found" };
    if (request.status !== "pending") return { success: false, error: `Request is ${request.status}` };

    const organizationId = `org_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);

    runExecute(
      "INSERT INTO organizations (id, name, owner_address, active, created_at) VALUES (?, ?, ?, 1, ?)",
      organizationId, request.name, request.owner_address, now
    );

    runExecute(
      "UPDATE organization_requests SET status = 'approved' WHERE id = ?",
      requestId
    );

    this.bus.emit({ type: "OrganizationApproved", data: { requestId } });
    this.bus.emit({ type: "OrganizationCreated", data: { organizationId, name: request.name } });

    // Persist events to DB
    try {
      runExecute(
        "INSERT INTO events (event_type, data, created_at) VALUES (?, ?, ?)",
        "OrganizationCreated",
        JSON.stringify({ organizationId, name: request.name }),
        now
      );
    } catch {}

    return { success: true, organizationId };
  }

  rejectRequest(requestId: string, reason?: string): { success: boolean; error?: string } {
    const request = runSingle<any>("SELECT * FROM organization_requests WHERE id = ?", requestId);
    if (!request) return { success: false, error: "Request not found" };
    if (request.status !== "pending") return { success: false, error: `Request is ${request.status}` };

    runExecute("UPDATE organization_requests SET status = 'rejected' WHERE id = ?", requestId);
    return { success: true };
  }

  getRequest(requestId: string): OrganizationRequest | undefined {
    return runSingle<OrganizationRequest>("SELECT * FROM organization_requests WHERE id = ?", requestId);
  }
}

let _authority: AuthorityService | null = null;
export function getAuthorityService(): AuthorityService {
  if (!_authority) _authority = new AuthorityService();
  return _authority;
}
