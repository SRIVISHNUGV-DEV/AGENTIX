"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockchainService = void 0;
exports.getBlockchainService = getBlockchainService;
exports.initializeBlockchainService = initializeBlockchainService;
exports.shutdownBlockchainService = shutdownBlockchainService;
const ethers_1 = require("ethers");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const bundler_1 = require("./bundler");
// Helper to normalize address checksums
const normalizeAddress = (addr) => {
    if (!addr)
        return "";
    try {
        return ethers_1.ethers.getAddress(addr.toLowerCase());
    }
    catch {
        return addr;
    }
};
const RPC_URLS = parseUrlList(process.env.RPC_URLS || process.env.RPC_URL || "http://127.0.0.1:8545");
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const CHAIN_ID = Number(process.env.CHAIN_ID || "11155111");
const NETWORK_NAME = process.env.NETWORK_NAME || "sepolia";
const DEFAULT_SESSION_MANAGER_ADDRESS = normalizeAddress(process.env.SESSION_MANAGER_ADDRESS || "");
const DEFAULT_CREDENTIAL_REGISTRY_ADDRESS = normalizeAddress(process.env.CREDENTIAL_REGISTRY_ADDRESS || "");
const DEFAULT_AGENT_WALLET_FACTORY_ADDRESS = normalizeAddress(process.env.AGENT_WALLET_FACTORY_ADDRESS || "");
const DEFAULT_AGENT_WALLET_IMPLEMENTATION_ADDRESS = normalizeAddress(process.env.AGENT_WALLET_IMPLEMENTATION_ADDRESS || "");
const DEFAULT_VERIFIER_ADDRESS = normalizeAddress(process.env.VERIFIER_ADDRESS || "");
const DEFAULT_ENTRY_POINT_ADDRESS = normalizeAddress(process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108");
const DEFAULT_MAX_FEE_PER_GAS_GWEI = process.env.BUNDLER_MAX_FEE_PER_GAS_GWEI || "";
const DEFAULT_MAX_PRIORITY_FEE_PER_GAS_GWEI = process.env.BUNDLER_MAX_PRIORITY_FEE_PER_GAS_GWEI || "";
const SESSION_MANAGER_ARTIFACT = "src_SessionManager_sol_SessionManager";
const FACTORY_ARTIFACT = "src_AgentWalletFactory_sol_AgentWalletFactory";
const REGISTRY_ARTIFACT = "src_CredentialRegistry_sol_CredentialRegistry";
const VERIFIER_ARTIFACT = "src_Verifier_sol_Groth16Verifier";
const WALLET_ARTIFACT = "src_AgentWallet_sol_AgentWallet";
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isRateLimitError(error) {
    const message = String(error?.message ?? error ?? "");
    return (message.includes("\"code\": 429") ||
        message.includes("compute units per second capacity") ||
        message.includes("Too Many Requests") ||
        message.includes("rate limit"));
}
function loadArtifact(name) {
    const baseDir = path_1.default.join(__dirname, "../../../contracts");
    const hardhatArtifactPath = resolveHardhatArtifactPath(baseDir, name);
    const nestedAbi = path_1.default.join(baseDir, `contracts_${name}.abi`);
    const nestedBin = path_1.default.join(baseDir, `contracts_${name}.bin`);
    const directAbi = path_1.default.join(baseDir, `${name}.abi`);
    const directBin = path_1.default.join(baseDir, `${name}.bin`);
    if (hardhatArtifactPath && fs_1.default.existsSync(hardhatArtifactPath)) {
        const artifact = JSON.parse(fs_1.default.readFileSync(hardhatArtifactPath, "utf8"));
        return {
            abi: artifact.abi,
            bytecode: artifact.bytecode
        };
    }
    const abiPath = fs_1.default.existsSync(directAbi) ? directAbi : nestedAbi;
    const binPath = fs_1.default.existsSync(directBin) ? directBin : nestedBin;
    return {
        abi: JSON.parse(fs_1.default.readFileSync(abiPath, "utf8")),
        bytecode: `0x${fs_1.default.readFileSync(binPath, "utf8").trim()}`
    };
}
function resolveHardhatArtifactPath(baseDir, name) {
    const match = /^(.+)_([^_]+)_sol_(.+)$/.exec(name);
    if (!match) {
        return null;
    }
    const [, sourceGroup, sourceName, contractName] = match;
    const sourcePath = path_1.default.join(baseDir, "artifacts", sourceGroup, `${sourceName}.sol`, `${contractName}.json`);
    return sourcePath;
}
class BlockchainService {
    provider;
    wallet;
    bundler;
    constructor() {
        this.provider = createProvider();
        this.wallet = new ethers_1.ethers.Wallet(PRIVATE_KEY, this.provider);
        this.bundler = new bundler_1.BundlerService(this.provider, DEFAULT_ENTRY_POINT_ADDRESS);
    }
    getRegistryAbi() {
        return loadArtifact(REGISTRY_ARTIFACT).abi;
    }
    getSessionManagerAbi() {
        return loadArtifact(SESSION_MANAGER_ARTIFACT).abi;
    }
    getFactoryAbi() {
        return loadArtifact(FACTORY_ARTIFACT).abi;
    }
    getWalletAbi() {
        return loadArtifact(WALLET_ARTIFACT).abi;
    }
    getContract(address, abi) {
        return new ethers_1.ethers.Contract(address, abi, this.wallet);
    }
    async withRpcRetry(label, operation, attempts = 5) {
        let delayMs = 1200;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                if (!isRateLimitError(error) || attempt === attempts) {
                    throw error;
                }
                console.warn(`${label} hit RPC rate limit; retrying in ${delayMs}ms (attempt ${attempt}/${attempts})`);
                await sleep(delayMs);
                delayMs *= 2;
            }
        }
        throw new Error(`${label} failed after retries`);
    }
    async deployArtifact(name, args = []) {
        const { abi, bytecode } = loadArtifact(name);
        const factory = new ethers_1.ethers.ContractFactory(abi, bytecode, this.wallet);
        const contract = await this.withRpcRetry(`deploy ${name}`, () => factory.deploy(...args));
        await this.withRpcRetry(`wait deployment ${name}`, () => contract.waitForDeployment());
        return contract;
    }
    normalizeScalars(value) {
        if (typeof value === "bigint") {
            return value;
        }
        if (typeof value === "number") {
            return BigInt(Math.trunc(value));
        }
        if (typeof value === "string" && /^\d+$/.test(value)) {
            return BigInt(value);
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.normalizeScalars(item));
        }
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.normalizeScalars(item)]));
        }
        return value;
    }
    async getOrganizationContracts(db, orgId) {
        const row = await db.get(`
            SELECT *
            FROM organization_contracts
            WHERE org_id = ?
            `, orgId);
        if (row) {
            return {
                orgId,
                chainId: row.chain_id,
                networkName: row.network_name,
                verifierAddress: row.verifier_address,
                credentialRegistryAddress: row.credential_registry_address,
                sessionManagerAddress: row.session_manager_address,
                agentWalletFactoryAddress: row.agent_wallet_factory_address,
                agentWalletImplementationAddress: row.agent_wallet_implementation_address,
                entryPointAddress: row.entry_point_address,
                deploymentTxHashes: row.deployment_tx_hashes ? JSON.parse(row.deployment_tx_hashes) : null
            };
        }
        return {
            orgId,
            chainId: CHAIN_ID,
            networkName: NETWORK_NAME,
            verifierAddress: DEFAULT_VERIFIER_ADDRESS,
            credentialRegistryAddress: DEFAULT_CREDENTIAL_REGISTRY_ADDRESS,
            sessionManagerAddress: DEFAULT_SESSION_MANAGER_ADDRESS,
            agentWalletFactoryAddress: DEFAULT_AGENT_WALLET_FACTORY_ADDRESS,
            agentWalletImplementationAddress: DEFAULT_AGENT_WALLET_IMPLEMENTATION_ADDRESS,
            entryPointAddress: DEFAULT_ENTRY_POINT_ADDRESS,
            deploymentTxHashes: null
        };
    }
    async ensureOrganizationContracts(db, orgId, options = {}) {
        const existing = await db.get(`
            SELECT org_id
            FROM organization_contracts
            WHERE org_id = ?
            `, orgId);
        if (!existing || options.force) {
            return this.deployOrganizationContracts(db, orgId, options);
        }
        return this.getOrganizationContracts(db, orgId);
    }
    async ensureSharedContracts(db) {
        const existing = await db.get(`
            SELECT *
            FROM shared_contracts
            WHERE id = 1
            `);
        if (existing?.verifier_address && existing?.agent_wallet_implementation_address) {
            return {
                verifierAddress: existing.verifier_address,
                walletImplementationAddress: existing.agent_wallet_implementation_address,
                entryPointAddress: existing.entry_point_address || DEFAULT_ENTRY_POINT_ADDRESS,
            };
        }
        const verifier = DEFAULT_VERIFIER_ADDRESS
            ? null
            : await this.deployArtifact(VERIFIER_ARTIFACT);
        const walletImplementation = DEFAULT_AGENT_WALLET_IMPLEMENTATION_ADDRESS
            ? null
            : await this.deployArtifact(WALLET_ARTIFACT);
        const verifierAddress = DEFAULT_VERIFIER_ADDRESS || await verifier.getAddress();
        const walletImplementationAddress = DEFAULT_AGENT_WALLET_IMPLEMENTATION_ADDRESS || await walletImplementation.getAddress();
        const entryPointAddress = existing?.entry_point_address || DEFAULT_ENTRY_POINT_ADDRESS;
        await db.run(`
            INSERT INTO shared_contracts (
                id,
                verifier_address,
                agent_wallet_implementation_address,
                entry_point_address,
                deployment_tx_hashes,
                updated_at
            )
            VALUES (1, ?, ?, ?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)
            ON CONFLICT(id) DO UPDATE SET
                verifier_address = excluded.verifier_address,
                agent_wallet_implementation_address = excluded.agent_wallet_implementation_address,
                entry_point_address = excluded.entry_point_address,
                deployment_tx_hashes = excluded.deployment_tx_hashes,
                updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
            `, verifierAddress, walletImplementationAddress, entryPointAddress, JSON.stringify({
            verifier: verifier?.deploymentTransaction()?.hash ?? null,
            walletImplementation: walletImplementation?.deploymentTransaction()?.hash ?? null,
            entryPoint: entryPointAddress
        }));
        return {
            verifierAddress,
            walletImplementationAddress,
            entryPointAddress
        };
    }
    async deployOrganizationContracts(db, orgId, options = {}) {
        const existing = await db.get(`SELECT org_id FROM organization_contracts WHERE org_id = ?`, orgId);
        if (existing && !options.force) {
            return this.getOrganizationContracts(db, orgId);
        }
        if (existing && options.force) {
            await db.run(`
                DELETE FROM organization_contracts
                WHERE org_id = ?
                `, orgId);
        }
        const shared = await this.ensureSharedContracts(db);
        const verifierAddress = shared.verifierAddress;
        const walletImplementationAddress = shared.walletImplementationAddress;
        const entryPointAddress = shared.entryPointAddress;
        const registry = await this.deployArtifact(REGISTRY_ARTIFACT);
        const sessionManager = await this.deployArtifact(SESSION_MANAGER_ARTIFACT, [
            verifierAddress,
            await registry.getAddress()
        ]);
        const walletFactory = await this.deployArtifact(FACTORY_ARTIFACT, [
            walletImplementationAddress,
            await sessionManager.getAddress(),
            entryPointAddress
        ]);
        const registryContract = this.getContract(await registry.getAddress(), this.getRegistryAbi());
        const sessionManagerAddress = await sessionManager.getAddress();
        const setSessionManagerTx = await this.withRpcRetry("setSessionManager", () => registryContract.setSessionManager(sessionManagerAddress, true));
        await this.withRpcRetry("wait setSessionManager", () => setSessionManagerTx.wait());
        const deploymentTxHashes = {
            registry: registry.deploymentTransaction()?.hash ?? null,
            sessionManager: sessionManager.deploymentTransaction()?.hash ?? null,
            walletFactory: walletFactory.deploymentTransaction()?.hash ?? null,
            setSessionManager: setSessionManagerTx.hash,
            verifier: verifierAddress,
            walletImplementation: walletImplementationAddress,
            entryPoint: entryPointAddress
        };
        await db.run(`
            INSERT INTO organization_contracts
            (
                org_id,
                chain_id,
                network_name,
                verifier_address,
                credential_registry_address,
                session_manager_address,
                agent_wallet_factory_address,
                agent_wallet_implementation_address,
                entry_point_address,
                deployment_tx_hashes,
                updated_at
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,EXTRACT(EPOCH FROM NOW())::INTEGER)
            ON CONFLICT(org_id) DO UPDATE SET
                chain_id = excluded.chain_id,
                network_name = excluded.network_name,
                verifier_address = excluded.verifier_address,
                credential_registry_address = excluded.credential_registry_address,
                session_manager_address = excluded.session_manager_address,
                agent_wallet_factory_address = excluded.agent_wallet_factory_address,
                agent_wallet_implementation_address = excluded.agent_wallet_implementation_address,
                entry_point_address = excluded.entry_point_address,
                deployment_tx_hashes = excluded.deployment_tx_hashes,
                updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
            `, orgId, CHAIN_ID, NETWORK_NAME, verifierAddress, await registry.getAddress(), await sessionManager.getAddress(), await walletFactory.getAddress(), walletImplementationAddress, entryPointAddress, JSON.stringify(deploymentTxHashes));
        return this.getOrganizationContracts(db, orgId);
    }
    async submitSessionForOrg(db, orgId, sessionId, sessionKey, maxValue, expiry, proof, publicSignals) {
        const contracts = await this.ensureOrganizationContracts(db, orgId);
        const sessionManager = this.getContract(contracts.sessionManagerAddress, this.getSessionManagerAbi());
        const normalizedProof = this.normalizeScalars(proof);
        const normalizedPublicSignals = this.normalizeScalars(publicSignals);
        const nullifierHex = ethers_1.ethers.toBeHex(normalizedPublicSignals[0], 32);
        const a = [
            normalizedProof.pi_a[0],
            normalizedProof.pi_a[1]
        ];
        const b = [
            [normalizedProof.pi_b[0][1], normalizedProof.pi_b[0][0]],
            [normalizedProof.pi_b[1][1], normalizedProof.pi_b[1][0]]
        ];
        const c = [
            normalizedProof.pi_c[0],
            normalizedProof.pi_c[1]
        ];
        const tx = await this.withRpcRetry("createSession", () => sessionManager.createSession(sessionId, sessionKey, BigInt(maxValue), BigInt(expiry), nullifierHex, a, b, c, normalizedPublicSignals));
        const receipt = await this.withRpcRetry("wait createSession", () => tx.wait());
        return {
            txHash: receipt.hash,
            contractAddress: contracts.sessionManagerAddress
        };
    }
    async updateActiveRootForOrg(db, orgId, root) {
        const contracts = await this.ensureOrganizationContracts(db, orgId);
        const registry = this.getContract(contracts.credentialRegistryAddress, this.getRegistryAbi());
        const tx = await this.withRpcRetry("updateActiveRoot", () => registry.updateActiveRoot(root));
        const receipt = await this.withRpcRetry("wait updateActiveRoot", () => tx.wait());
        return {
            txHash: receipt.hash,
            contractAddress: contracts.credentialRegistryAddress
        };
    }
    async updateRevokedRootForOrg(db, orgId, root) {
        const contracts = await this.ensureOrganizationContracts(db, orgId);
        const registry = this.getContract(contracts.credentialRegistryAddress, this.getRegistryAbi());
        const tx = await this.withRpcRetry("updateRevokedSecretRoot", () => registry.updateRevokedSecretRoot(root));
        const receipt = await this.withRpcRetry("wait updateRevokedSecretRoot", () => tx.wait());
        return {
            txHash: receipt.hash,
            contractAddress: contracts.credentialRegistryAddress
        };
    }
    async createWalletForOrg(db, orgId, owner) {
        const contracts = await this.ensureOrganizationContracts(db, orgId);
        const walletFactory = this.getContract(contracts.agentWalletFactoryAddress, this.getFactoryAbi());
        const salt = ethers_1.ethers.keccak256(ethers_1.ethers.solidityPacked(["uint256", "address", "uint256", "uint256"], [BigInt(orgId), owner, BigInt(CHAIN_ID), BigInt(Date.now())]));
        const tx = await this.withRpcRetry("createWallet", () => walletFactory["createWallet(address,bytes32)"](owner, salt));
        const receipt = await this.withRpcRetry("wait createWallet", () => tx.wait());
        const walletCreated = receipt.logs
            .map((log) => {
            try {
                return walletFactory.interface.parseLog(log);
            }
            catch {
                return null;
            }
        })
            .find((parsed) => parsed && parsed.name === "WalletCreated");
        return {
            txHash: receipt.hash,
            walletAddress: walletCreated?.args?.wallet,
            ownerAddress: owner,
            sessionManagerAddress: contracts.sessionManagerAddress,
            implementationAddress: contracts.agentWalletImplementationAddress,
            entryPointAddress: contracts.entryPointAddress,
            factorySalt: salt,
            walletKind: "erc4337",
            factoryAddress: contracts.agentWalletFactoryAddress
        };
    }
    async fundAddress(to, amountEth) {
        const tx = await this.withRpcRetry("fundAddress", () => this.wallet.sendTransaction({
            to,
            value: ethers_1.ethers.parseEther(amountEth)
        }));
        const receipt = await this.withRpcRetry("wait fundAddress", () => tx.wait());
        return {
            txHash: receipt?.hash ?? tx.hash,
            to,
            amountEth
        };
    }
    async prepareUserOperationForWallet(db, walletAddress, callData, initCode = "0x") {
        const walletRecord = await db.get(`
            SELECT *
            FROM wallets
            WHERE wallet_address = ?
            `, walletAddress);
        if (!walletRecord) {
            throw new Error("wallet not found");
        }
        const entryPointAddress = walletRecord.entry_point_address || DEFAULT_ENTRY_POINT_ADDRESS;
        const bundler = new bundler_1.BundlerService(this.provider, entryPointAddress);
        const nonce = await bundler.getNonce(walletAddress);
        let maxPriorityFeePerGas;
        let maxFeePerGas;
        if (DEFAULT_MAX_FEE_PER_GAS_GWEI && DEFAULT_MAX_PRIORITY_FEE_PER_GAS_GWEI) {
            maxPriorityFeePerGas = ethers_1.ethers.parseUnits(DEFAULT_MAX_PRIORITY_FEE_PER_GAS_GWEI, "gwei");
            maxFeePerGas = ethers_1.ethers.parseUnits(DEFAULT_MAX_FEE_PER_GAS_GWEI, "gwei");
        }
        else {
            const feeData = await this.provider.getFeeData();
            maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? ethers_1.ethers.parseUnits("1", "gwei");
            maxFeePerGas = feeData.maxFeePerGas ?? maxPriorityFeePerGas * 2n;
        }
        let userOp = {
            sender: walletAddress,
            nonce: ethers_1.ethers.toBeHex(nonce),
            initCode,
            callData,
            accountGasLimits: bundler.buildPackedGasLimits(500000n, 500000n),
            preVerificationGas: ethers_1.ethers.toBeHex(100000n),
            gasFees: bundler.buildPackedGasFees(maxPriorityFeePerGas, maxFeePerGas),
            paymasterAndData: "0x",
            signature: "0x"
        };
        if (bundler.isConfigured()) {
            const estimate = await bundler.estimateUserOperationGas(userOp, entryPointAddress);
            userOp = {
                ...userOp,
                preVerificationGas: estimate.preVerificationGas ?? userOp.preVerificationGas,
                accountGasLimits: bundler.buildPackedGasLimits(BigInt(estimate.verificationGasLimit ?? "500000"), BigInt(estimate.callGasLimit ?? "500000"))
            };
        }
        const userOpHash = await bundler.getUserOpHash(userOp);
        return {
            walletAddress,
            entryPointAddress,
            userOp,
            userOpHash
        };
    }
    async submitUserOperation(userOp, entryPointAddress) {
        const bundler = new bundler_1.BundlerService(this.provider, entryPointAddress);
        const userOpHash = await bundler.sendUserOperation(userOp, entryPointAddress);
        return {
            userOpHash,
            entryPointAddress
        };
    }
    async getUserOperationReceipt(userOpHash, entryPointAddress) {
        const bundler = new bundler_1.BundlerService(this.provider, entryPointAddress || DEFAULT_ENTRY_POINT_ADDRESS);
        return bundler.getUserOperationReceipt(userOpHash);
    }
    async setWhitelistedParty(walletAddress, party, status) {
        const walletContract = this.getContract(walletAddress, this.getWalletAbi());
        const tx = await this.withRpcRetry("setWhiteListedParty", () => walletContract.setWhiteListedParty(party, status));
        const receipt = await this.withRpcRetry("wait setWhiteListedParty", () => tx.wait());
        return {
            txHash: receipt.hash,
            walletAddress,
            party,
            status
        };
    }
    async setWhitelistedPartyBatch(walletAddress, parties, statuses) {
        if (parties.length !== statuses.length) {
            throw new Error("Array length mismatch: parties and statuses must have same length");
        }
        if (parties.length === 0) {
            throw new Error("Empty arrays: at least one party required");
        }
        const walletContract = this.getContract(walletAddress, this.getWalletAbi());
        const tx = await this.withRpcRetry("setWhiteListedPartyBatch", () => walletContract.setWhiteListedPartyBatch(parties, statuses));
        const receipt = await this.withRpcRetry("wait setWhiteListedPartyBatch", () => tx.wait());
        return {
            txHash: receipt.hash,
            walletAddress,
            parties,
            statuses
        };
    }
    async getWhitelistedParties(walletAddress, db) {
        // For Alchemy free tier compatibility, try to get whitelist from database first
        if (db) {
            try {
                const dbParties = await db.all(`SELECT address FROM wallet_whitelist WHERE wallet_address = ? AND is_active = 1`, walletAddress.toLowerCase());
                if (dbParties.length > 0) {
                    return dbParties.map((row) => row.address);
                }
            }
            catch {
                // Table might not exist, fall through to contract query
            }
        }
        // Fallback: Query only last 10 blocks for Alchemy free tier compatibility
        const walletContract = this.getContract(walletAddress, this.getWalletAbi());
        try {
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 10);
            const filter = walletContract.filters.WhiteListUpdated();
            const events = await walletContract.queryFilter(filter, fromBlock, currentBlock);
            const parties = new Set();
            for (const event of events) {
                if ('args' in event && event.args) {
                    const party = event.args.party;
                    const status = event.args.status;
                    if (status) {
                        parties.add(party);
                    }
                    else {
                        parties.delete(party);
                    }
                }
            }
            return Array.from(parties);
        }
        catch (error) {
            // If event query fails, return empty array (whitelist not queryable via events)
            console.warn(`[getWhitelistedParties] Could not query events for ${walletAddress}:`, error?.message || error);
            return [];
        }
    }
    async isWhitelisted(walletAddress, party) {
        const walletContract = this.getContract(walletAddress, this.getWalletAbi());
        return await walletContract.whiteListedParties(party);
    }
    async getEventContracts(db) {
        const deployments = await db.all(`
            SELECT *
            FROM organization_contracts
            ORDER BY org_id ASC
            `);
        if (deployments.length === 0) {
            return [
                {
                    orgId: 0,
                    name: "CredentialRegistry",
                    address: DEFAULT_CREDENTIAL_REGISTRY_ADDRESS,
                    abi: this.getRegistryAbi()
                },
                {
                    orgId: 0,
                    name: "SessionManager",
                    address: DEFAULT_SESSION_MANAGER_ADDRESS,
                    abi: this.getSessionManagerAbi()
                },
                {
                    orgId: 0,
                    name: "AgentWalletFactory",
                    address: DEFAULT_AGENT_WALLET_FACTORY_ADDRESS,
                    abi: this.getFactoryAbi()
                }
            ].filter((entry) => entry.address);
        }
        return deployments.flatMap((deployment) => [
            {
                orgId: deployment.org_id,
                name: "CredentialRegistry",
                address: deployment.credential_registry_address,
                abi: this.getRegistryAbi()
            },
            {
                orgId: deployment.org_id,
                name: "SessionManager",
                address: deployment.session_manager_address,
                abi: this.getSessionManagerAbi()
            },
            {
                orgId: deployment.org_id,
                name: "AgentWalletFactory",
                address: deployment.agent_wallet_factory_address,
                abi: this.getFactoryAbi()
            }
        ]);
    }
    // ============================================
    // EntryPoint Gas Deposit Methods
    // ============================================
    /**
     * Get the EntryPoint balance for an agent wallet
     * This is the gas funding available for transaction execution
     */
    async getEntryPointBalance(walletAddress) {
        const entryPointAddress = DEFAULT_ENTRY_POINT_ADDRESS;
        if (!entryPointAddress) {
            throw new Error("EntryPoint address not configured");
        }
        const entryPointAbi = [
            "function balanceOf(address account) external view returns (uint256)"
        ];
        const entryPoint = new ethers_1.ethers.Contract(entryPointAddress, entryPointAbi, this.provider);
        const balance = await entryPoint.balanceOf(walletAddress);
        return balance;
    }
    /**
     * Deposit ETH to the EntryPoint for an agent wallet
     *
     * This funds the agent's smart account so it can pay for gas
     * during transaction execution via ERC-4337.
     *
     * @param walletAddress - The agent wallet address
     * @param amountWei - Amount to deposit in wei
     */
    async depositToEntryPoint(walletAddress, amountWei) {
        const entryPointAddress = DEFAULT_ENTRY_POINT_ADDRESS;
        if (!entryPointAddress) {
            throw new Error("EntryPoint address not configured");
        }
        const entryPointAbi = [
            "function depositTo(address account) external payable"
        ];
        const entryPoint = new ethers_1.ethers.Contract(entryPointAddress, entryPointAbi, this.wallet);
        // Send transaction to deposit to EntryPoint
        const tx = await entryPoint.depositTo(walletAddress, { value: amountWei });
        const receipt = await tx.wait();
        // Get new balance
        const newBalance = await this.getEntryPointBalance(walletAddress);
        return {
            txHash: receipt.hash,
            newBalance: ethers_1.ethers.formatEther(newBalance)
        };
    }
}
exports.BlockchainService = BlockchainService;
function parseUrlList(value) {
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}
function createProvider() {
    const providers = RPC_URLS.map((rpcUrl) => new ethers_1.ethers.JsonRpcProvider(rpcUrl, { chainId: CHAIN_ID, name: NETWORK_NAME }, { staticNetwork: true }));
    if (providers.length === 0) {
        throw new Error("no RPC URL configured");
    }
    if (providers.length === 1) {
        return providers[0];
    }
    return new ethers_1.ethers.FallbackProvider(providers.map((provider, index) => ({
        provider,
        priority: index + 1,
        weight: 1,
        stallTimeout: 1500
    })));
}
// FLAW 10 FIX: Proper singleton with health checks and reconnection
let blockchainServiceInstance = null;
let healthCheckInterval = null;
let isReconnecting = false;
function getBlockchainService() {
    if (!blockchainServiceInstance) {
        blockchainServiceInstance = new BlockchainService();
        startHealthCheck();
    }
    return blockchainServiceInstance;
}
async function checkProviderHealth() {
    if (!blockchainServiceInstance)
        return false;
    try {
        const blockNumber = await blockchainServiceInstance.provider.getBlockNumber();
        return blockNumber > 0;
    }
    catch {
        return false;
    }
}
function startHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }
    healthCheckInterval = setInterval(async () => {
        if (isReconnecting)
            return;
        const healthy = await checkProviderHealth();
        if (!healthy && blockchainServiceInstance) {
            console.warn("[BlockchainService] Health check failed, attempting reconnection...");
            isReconnecting = true;
            try {
                blockchainServiceInstance.provider = createProvider();
                blockchainServiceInstance.wallet = new ethers_1.ethers.Wallet(PRIVATE_KEY, blockchainServiceInstance.provider);
                blockchainServiceInstance.bundler = new bundler_1.BundlerService(blockchainServiceInstance.provider, DEFAULT_ENTRY_POINT_ADDRESS);
                console.log("[BlockchainService] Reconnected successfully");
            }
            catch (error) {
                console.error("[BlockchainService] Reconnection failed:", error);
            }
            finally {
                isReconnecting = false;
            }
        }
    }, 60000); // Check every minute
}
async function initializeBlockchainService() {
    const service = getBlockchainService();
    // Verify connection on startup
    try {
        const blockNumber = await service.provider.getBlockNumber();
        console.log(`[BlockchainService] Connected to ${NETWORK_NAME} at block ${blockNumber}`);
    }
    catch (error) {
        console.error("[BlockchainService] Initial connection failed:", error);
        // Don't throw - allow service to start and retry later
    }
    return service;
}
function shutdownBlockchainService() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
    blockchainServiceInstance = null;
}
