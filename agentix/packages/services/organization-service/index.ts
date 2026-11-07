import { runExecute, runSingleCamel, runQueryCamel } from "../../core/database";
import { getEventBus } from "../../core/eventbus";
import type { Organization } from "../../shared/types";

export class OrganizationService {
  private bus = getEventBus();

  /**
   * Fetches one organization by id.
   * WHY: the read path for every flow that needs an org's owner, anchor, or active flag before acting on its behalf.
   * @returns The organization, or undefined when no row matches.
   * @throws Throws on DB errors.
   * Maps to: internal — AuthorityService.approveRequest (rows it creates); OrganizationService.deactivate / reactivate (pre-check read).
   * Side effects: none (read-only).
   */
  get(id: string): Organization | undefined {
    return runSingleCamel<Organization>("SELECT * FROM organizations WHERE id = ?", id);
  }

  /**
   * Lists all organizations, newest first.
   * WHY: the operator's org inventory, including deactivated ones.
   * @returns All organizations ordered by created_at descending; empty array when none exist.
   * @throws Throws on DB errors.
   * Maps to: internal — OrganizationService.listActive (unfiltered form).
   * Side effects: none (read-only).
   */
  list(): Organization[] {
    return runQueryCamel<Organization>("SELECT * FROM organizations ORDER BY created_at DESC");
  }

  /**
   * Lists only active organizations, newest first.
   * WHY: most callers must only act for orgs that have not been deactivated — this is the safe default list.
   * @returns Active organizations ordered by created_at descending; empty array when none are active.
   * @throws Throws on DB errors.
   * Maps to: internal — OrganizationService.list (active-only filter).
   * Side effects: none (read-only).
   */
  listActive(): Organization[] {
    return runQueryCamel<Organization>("SELECT * FROM organizations WHERE active = 1 ORDER BY created_at DESC");
  }

  /**
   * Deactivates an organization and notifies listeners.
   * WHY: the kill-switch for a compromised or offboarded org — deactivation must be visible to anything gating on active status.
   * @returns `{ success: true }`, or `{ success: false, error }` when the org does not exist. Deactivating an already-inactive org still succeeds.
   * @throws Throws on DB errors.
   * Maps to: event OrganizationDeactivated; internal — OrganizationService.get (existence check).
   * Side effects: sets active = 0 in the DB and emits OrganizationDeactivated. Does not revoke the org's credentials or sessions — those stay usable unless revoked separately.
   */
  deactivate(id: string): { success: boolean; error?: string } {
    const org = this.get(id);
    if (!org) return { success: false, error: "Organization not found" };
    runExecute("UPDATE organizations SET active = 0 WHERE id = ?", id);
    this.bus.emit({ type: "OrganizationDeactivated", data: { organizationId: id } });
    return { success: true };
  }

  /**
   * Reactivates a deactivated organization.
   * WHY: the undo for deactivate() — restores an org that was disabled in error or has been reinstated.
   * @returns `{ success: true }`, or `{ success: false, error }` when the org does not exist. Reactivating an already-active org still succeeds.
   * @throws Throws on DB errors.
   * Maps to: internal — OrganizationService.deactivate (inverse operation); no event is emitted, unlike deactivate().
   * Side effects: sets active = 1 in the DB. No event is emitted, so listeners do not learn of the reactivation.
   */
  reactivate(id: string): { success: boolean; error?: string } {
    const org = this.get(id);
    if (!org) return { success: false, error: "Organization not found" };
    runExecute("UPDATE organizations SET active = 1 WHERE id = ?", id);
    return { success: true };
  }

  /**
   * Counts all organizations, active and inactive.
   * WHY: the cheap cardinality check for dashboards and setup guards.
   * @returns The row count, 0 when none.
   * @throws Throws on DB errors.
   * Maps to: internal — OrganizationService.activeCount (unfiltered form).
   * Side effects: none (read-only).
   */
  count(): number {
    const result = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM organizations");
    return result?.count || 0;
  }

  /**
   * Counts only active organizations.
   * WHY: the live-org count for dashboards and for gates that care about usable orgs, not history.
   * @returns The count of rows with active = 1, 0 when none.
   * @throws Throws on DB errors.
   * Maps to: internal — OrganizationService.count (active-only form).
   * Side effects: none (read-only).
   */
  activeCount(): number {
    const result = runSingleCamel<{ count: number }>("SELECT COUNT(*) as count FROM organizations WHERE active = 1");
    return result?.count || 0;
  }
}

let _svc: OrganizationService | null = null;
/**
 * Returns the process-wide singleton OrganizationService.
 * WHY: one service per process — all org reads share the same event-bus subscription surface.
 * @returns The singleton instance.
 * @throws Never throws.
 * Maps to: internal — OrganizationService (module-level accessor).
 * Side effects: creates the singleton on first call.
 */
export function getOrganizationService(): OrganizationService {
  if (!_svc) _svc = new OrganizationService();
  return _svc;
}
