import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import type { Organization } from "../../shared/types";

export class OrganizationService {
  private bus = getEventBus();

  get(id: string): Organization | undefined {
    return runSingleCamel<Organization>("SELECT * FROM organizations WHERE id = ?", id);
  }

  list(): Organization[] {
    return runQueryCamel<Organization>("SELECT * FROM organizations ORDER BY created_at DESC");
  }

  listActive(): Organization[] {
    return runQueryCamel<Organization>("SELECT * FROM organizations WHERE active = 1 ORDER BY created_at DESC");
  }

  deactivate(id: string): { success: boolean; error?: string } {
    const org = this.get(id);
    if (!org) return { success: false, error: "Organization not found" };
    runExecute("UPDATE organizations SET active = 0 WHERE id = ?", id);
    this.bus.emit({ type: "OrganizationDeactivated", data: { organizationId: id } });
    return { success: true };
  }

  reactivate(id: string): { success: boolean; error?: string } {
    const org = this.get(id);
    if (!org) return { success: false, error: "Organization not found" };
    runExecute("UPDATE organizations SET active = 1 WHERE id = ?", id);
    return { success: true };
  }

  count(): number {
    const result = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM organizations");
    return result?.count || 0;
  }

  activeCount(): number {
    const result = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM organizations WHERE active = 1");
    return result?.count || 0;
  }
}

let _svc: OrganizationService | null = null;
export function getOrganizationService(): OrganizationService {
  if (!_svc) _svc = new OrganizationService();
  return _svc;
}
