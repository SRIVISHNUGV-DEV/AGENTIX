export type AgentixScope = string

export const STANDARD_SCOPES: Record<string, {
  description: string
  reveals: string[]
  category: "identity" | "authorization" | "attestation"
}> = {
  "agentix:scope:agent-id": {
    description: "Reveal the agent's numeric ID",
    reveals: ["agentId"],
    category: "identity",
  },
  "agentix:scope:org-membership": {
    description: "Prove agent belongs to an org (orgId is disclosed)",
    reveals: ["orgId"],
    category: "identity",
  },
  "agentix:scope:org-membership:blind": {
    description: "Prove org membership without revealing orgId",
    reveals: ["orgId (hashed)"],
    category: "attestation",
  },
  "agentix:scope:permissions": {
    description: "Reveal the agent's permission bitmask",
    reveals: ["maxValue (permissions)"],
    category: "authorization",
  },
  "agentix:scope:session-expiry": {
    description: "Reveal the session expiry timestamp",
    reveals: ["sessionExpiry"],
    category: "authorization",
  },
  "agentix:scope:nullifier": {
    description: "Reveal the proof nullifier (replay protection)",
    reveals: ["nullifier"],
    category: "attestation",
  },
  "agentix:scope:root:active": {
    description: "Prove active Merkle root matches on-chain state",
    reveals: ["activeRoot"],
    category: "attestation",
  },
  "agentix:scope:root:revoked": {
    description: "Prove revoked Merkle root matches on-chain state",
    reveals: ["revokedRoot"],
    category: "attestation",
  },
}

/**
 * Parse a public signal from the credential circuit and return a map of
 * scope -> value that the verifier can check.
 *
 * The credential circuit has 5 public signals:
 *   [0] nullifier
 *   [1] activeRoot
 *   [2] revokedRoot
 *   [3] maxValue (permissions bitmask)
 *   [4] sessionExpiry
 */
export function parsePublicSignals(
  publicSignals: string[],
  options?: { revealAgentId?: boolean; revealOrgId?: boolean }
): Record<string, string> {
  const [nullifier, activeRoot, revokedRoot, maxValue, sessionExpiry] = publicSignals

  const parsed: Record<string, string> = {
    "agentix:scope:nullifier": nullifier,
    "agentix:scope:root:active": activeRoot,
    "agentix:scope:root:revoked": revokedRoot,
    "agentix:scope:permissions": maxValue,
    "agentix:scope:session-expiry": sessionExpiry,
  }

  return parsed
}

export function computeResolvedScopes(
  publicSignals: string[],
  requestedScopes: string[]
): { resolved: string[]; missing: string[] } {
  const available = parsePublicSignals(publicSignals)
  const resolved: string[] = []
  const missing: string[] = []

  for (const scope of requestedScopes) {
    if (scope === "agentix:scope:*") {
      resolved.push(...Object.keys(available))
    } else if (scope in available) {
      resolved.push(scope)
    } else if (scope.startsWith("agentix:scope:")) {
      missing.push(scope)
    } else {
      resolved.push(scope)
    }
  }

  return { resolved: Array.from(new Set(resolved)), missing }
}
