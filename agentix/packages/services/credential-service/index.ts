import { runExecute, runSingle, runQuery } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import { generateId } from "../../shared/utils";
import type { Credential } from "../../shared/types";

export class CredentialService {
  private bus = getEventBus();

  issue(organizationId: string, agentId: number, permissions: number, expiry: number, nullifier: string, secret: string): Credential {
    const credentialId = `cred_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);

    runExecute(
      "INSERT INTO credentials (credential_id, organization_id, agent_id, nullifier, secret, permissions, expiry, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      credentialId, organizationId, agentId, nullifier, secret, permissions, expiry, now
    );

    const cred = runSingle<Credential>("SELECT * FROM credentials WHERE credential_id = ?", credentialId)!;
    this.bus.emit({ type: "CredentialIssued", data: { credentialId, organizationId, agentId } });
    return cred;
  }

  revoke(organizationId: string, agentId: number): { success: boolean; nullifier?: string; error?: string } {
    const cred = runSingle<Credential>(
      "SELECT * FROM credentials WHERE organization_id = ? AND agent_id = ? AND revoked = 0",
      organizationId, agentId
    );
    if (!cred) return { success: false, error: "Active credential not found" };

    const now = Math.floor(Date.now() / 1000);
    runExecute(
      "UPDATE credentials SET revoked = 1, revoked_at = ? WHERE credential_id = ?",
      now, cred.credentialId
    );

    this.bus.emit({ type: "CredentialRevoked", data: { organizationId, agentId } });
    return { success: true, nullifier: cred.nullifier };
  }

  get(organizationId: string, agentId: number): Credential | undefined {
    return runSingle<Credential>(
      "SELECT * FROM credentials WHERE organization_id = ? AND agent_id = ?",
      organizationId, agentId
    );
  }

  getById(credentialId: string): Credential | undefined {
    return runSingle<Credential>("SELECT * FROM credentials WHERE credential_id = ?", credentialId);
  }

  list(organizationId?: string): Credential[] {
    if (organizationId) {
      return runQuery<Credential>("SELECT * FROM credentials WHERE organization_id = ? ORDER BY created_at DESC", organizationId);
    }
    return runQuery<Credential>("SELECT * FROM credentials ORDER BY created_at DESC");
  }

  count(organizationId?: string): number {
    if (organizationId) {
      const r = runSingle<{ count: number }>("SELECT COUNT(*) as count FROM credentials WHERE organization_id = ?", organizationId);
      return r?.count || 0;
    }
    const r = runSingle<{ count: number }>("SELECT COUNT(*) as count FROM credentials");
    return r?.count || 0;
  }

  getHistory(organizationId: string): Credential[] {
    return runQuery<Credential>(
      "SELECT * FROM credentials WHERE organization_id = ? ORDER BY created_at DESC",
      organizationId
    );
  }
}

let _svc: CredentialService | null = null;
export function getCredentialService(): CredentialService {
  if (!_svc) _svc = new CredentialService();
  return _svc;
}
