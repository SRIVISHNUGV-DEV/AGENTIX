import { z } from "zod"
import { isAddress } from "ethers"

const hexAddress = z.string().refine((v) => isAddress(v), { message: "Invalid Ethereum address" })

const metadataRecord = z.record(
    z.string().regex(/^[a-zA-Z0-9_]+$/),
    z.union([z.string().max(1024), z.number(), z.boolean(), z.null()]),
).optional().refine(
    (val) => val === undefined || Object.keys(val).length <= 10,
    { message: "At most 10 metadata entries allowed" },
)

// Create org
export const createOrgSchema = z.object({
    name: z.string().min(2).max(120),
})

// Fund org
export const fundOrgSchema = z.object({
    amountEth: z.string().min(1).max(40),
})

// Deploy contracts
export const deployContractsSchema = z.object({
    force: z.boolean().optional(),
})

// Create agent
export const createAgentSchema = z.object({
    agentName: z.string().min(2).max(120),
    orgId: z.number().int().positive(),
})

// Issue credential
export const issueCredentialSchema = z.object({
    agentId: z.number().int().positive().optional(),
    orgId: z.number().int().positive().optional(),
    permissions: z.number().int().nonnegative().optional(),
    expiry: z.number().int().positive(),
    commitment: z.string().min(1).max(256),
    secretHash: z.string().min(1).max(256).nullable().optional(),
})

// Revoke credential
export const revokeCredentialSchema = z.object({
    agentId: z.number().int().positive(),
    secretHash: z.string().min(1).max(256),
})

// Create wallet
export const createWalletSchema = z.object({
    ownerAddress: hexAddress.optional(),
})

// Fund agent
export const fundAgentSchema = z.object({
    amountEth: z.string().min(1).max(40),
})

// Update capabilities
export const updateCapabilitiesSchema = z.object({
    orgId: z.number().int().positive(),
    status: z.enum(["active", "suspended", "restricted"]).optional(),
    credentialCeiling: z.number().int().nonnegative().optional(),
    defaultSessionDurationSeconds: z.number().int().nonnegative().optional(),
    maxSessionDurationSeconds: z.number().int().nonnegative().optional(),
    dailySpendLimitWei: z.string().optional(),
    dailyTxLimit: z.number().int().nonnegative().optional(),
    maxSingleTxWei: z.string().optional(),
    allowedRuntimeActions: z.array(z.string()).optional(),
    allowedProtocolTools: z.array(z.string()).optional(),
    walletAddress: hexAddress.optional(),
    metadata: metadataRecord,
})

// Create session
export const createSessionSchema = z.object({
    expiry: z.number().int().positive().optional().nullable(),
    dailyTxLimit: z.number().int().positive().optional().nullable(),
    dailySpendLimitWei: z.string().optional(),
    ownerSignature: z.string().min(1),
    sessionKeyPrivate: z.string().min(1),
    sessionKeyPublic: z.string().min(1),
    sessionIdOnChain: z.string().min(1),
})

// Transfer
export const transferSchema = z.object({
    agentId: z.number().int().positive(),
    to: hexAddress,
    valueWei: z.string(),
    data: z.string().optional(),
})

export const schemas = {
    createOrg: createOrgSchema,
    fundOrg: fundOrgSchema,
    deployContracts: deployContractsSchema,
    createAgent: createAgentSchema,
    issueCredential: issueCredentialSchema,
    revokeCredential: revokeCredentialSchema,
    createWallet: createWalletSchema,
    fundAgent: fundAgentSchema,
    updateCapabilities: updateCapabilitiesSchema,
    createSession: createSessionSchema,
    transfer: transferSchema,
} as const

export type SchemaName = keyof typeof schemas
