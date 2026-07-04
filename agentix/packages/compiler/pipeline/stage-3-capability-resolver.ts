import { ParsedIntent } from '../types/intent';
import { CapabilityGraph, ResolvedCapabilities, CapabilityNode, DelegationEdge, CredentialNode } from '../types/capability';
import { PluginRegistry } from '../plugins/registry';
import { CapabilityPlugin } from '../types/plugin';
import type { runQuery, runSingle } from '@agentix/database';

export class CapabilityResolver {
  constructor(private plugins: PluginRegistry) {}

  async resolve(intent: ParsedIntent): Promise<ResolvedCapabilities> {
    const agent = intent.agent || { identityId: 0, walletAddress: '' };
    const org = intent.organizationId
      ? { id: intent.organizationId, active: true }
      : { id: '', active: false };

    const graph: CapabilityGraph = {
      agent: {
        identityId: agent.identityId,
        walletAddress: agent.walletAddress,
      },
      organization: org,
      capabilities: [],
      delegations: [],
      credentials: [],
      grantedActions: [],
      restrictedActions: [],
      missingActions: [],
    };

    const capabilityPlugins = this.plugins.getByType('capability') as CapabilityPlugin[];
    for (const plugin of capabilityPlugins) {
      try {
        const result = await plugin.resolveCapabilities(
          { identityId: agent.identityId, walletAddress: agent.walletAddress },
          org
        );
        for (const cap of result.capabilities) {
          graph.capabilities.push({
            capabilityId: cap.capabilityId,
            actionHash: cap.actionHash,
            action: cap.action,
            grantor: cap.grantor,
            constraints: {
              maxValue: (cap.constraints.maxValue as string) || undefined,
              maxGas: (cap.constraints.maxGas as string) || undefined,
              expiry: (cap.constraints.expiry as number) || 0,
              allowedTargets: (cap.constraints.allowedTargets as string[]) || undefined,
              dailyLimit: (cap.constraints.dailyLimit as string) || undefined,
            },
            expiresAt: cap.expiresAt,
            onChainVerified: false,
          });
        }
      } catch {
        // Plugin failed — skip, continue with others
      }
    }

    const db: any = this._getDb();
    if (db) {
      try {
        const localCapabilities = db.query(
          'SELECT capability_id, name, hash FROM capabilities WHERE active = 1'
        ) as Record<string, unknown>[];
        for (const cap of localCapabilities) {
          if (!graph.capabilities.some((c) => c.capabilityId === cap.capability_id)) {
            graph.capabilities.push({
              capabilityId: cap.capability_id as string,
              actionHash: cap.hash as string,
              action: cap.name as string,
              grantor: '',
              constraints: { expiry: 0 },
              expiresAt: 0,
              onChainVerified: false,
            });
          }
        }
      } catch {}
    }

    if (graph.agent.identityId > 0) {
      try {
        const credentials = (db?.query(
          'SELECT credential_id, organization_id, agent_id, nullifier, permissions, expiry, revoked FROM credentials WHERE agent_id = ? AND revoked = 0',
          [graph.agent.identityId]
        ) || []) as Record<string, unknown>[];
        for (const cred of credentials) {
          graph.credentials.push({
            credentialId: cred.credential_id as string,
            organizationId: cred.organization_id as string,
            agentId: cred.agent_id as number,
            nullifier: cred.nullifier as string,
            permissions: cred.permissions as number,
            expiry: cred.expiry as number,
            revoked: Boolean(cred.revoked),
            onChainVerified: false,
          });
        }
      } catch {}
    }

    graph.grantedActions = [...new Set(graph.capabilities.map((c) => c.action))];

    const requiredAction = intent.normalizedAction;
    if (requiredAction && !graph.grantedActions.includes(requiredAction)) {
      graph.missingActions.push(requiredAction);
    }

    return {
      ...graph,
      canExecute: graph.missingActions.length === 0,
      missingExplicit: graph.missingActions,
      mustDelegate: [],
    };
  }

  private _getDb(): { query: Function } | null {
    try {
      const { runQuery } = require('@agentix/database');
      return { query: runQuery };
    } catch {
      return null;
    }
  }
}
