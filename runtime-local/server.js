"use strict";
/**
 * Agentix Local Runtime Server
 *
 * A local runtime that connects to OpenAI-compatible API for real conversations
 * with FUNCTION CALLING for actual blockchain execution.
 *
 * Capabilities:
 * - Send transactions to whitelisted addresses
 * - Batch transactions to multiple whitelisted addresses
 * - Deposit ETH to EntryPoint for gas
 * - Withdraw from EntryPoint
 * - Add/remove whitelist addresses
 * - Get wallet balance and info
 *
 * Run: npx tsx runtime-local/server.ts
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var cors_1 = require("cors");
var dotenv_1 = require("dotenv");
var node_fetch_1 = require("node-fetch");
var ethers_1 = require("ethers");
(0, dotenv_1.config)();
var app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '1mb' }));
// Configuration
var RUNTIME_ID = process.env.RUNTIME_ID || 'local-runtime-001';
var RUNTIME_PORT = process.env.RUNTIME_PORT || 3002;
var AGENTIX_API_URL = process.env.AGENTIX_API_URL || 'http://localhost:3001';
// OpenAI API Configuration
var OPENAI_API_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
var OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
var OPENAI_MODEL = process.env.OPENAI_MODEL || 'zai.glm-5';
// Blockchain Configuration
var RPC_URL = process.env.RPC_URL || '';
var PRIVATE_KEY = process.env.PRIVATE_KEY || '';
var CHAIN_ID = Number(process.env.CHAIN_ID || '84532');
// Initialize provider and wallet
var provider = null;
var signerWallet = null;
if (PRIVATE_KEY && RPC_URL) {
    try {
        provider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
        signerWallet = new ethers_1.ethers.Wallet(PRIVATE_KEY, provider);
        console.log("[blockchain] Initialized with address: ".concat(signerWallet.address));
    }
    catch (error) {
        console.error('[blockchain] Failed to initialize wallet:', error);
    }
}
// Full AgentWallet ABI
var AGENT_WALLET_ABI = [
    // Read functions
    'function owner() external view returns (address)',
    'function sessionManager() external view returns (address)',
    'function entryPoint() external view returns (address)',
    'function whiteListedParties(address) external view returns (bool)',
    'function checkBalance() external view returns (uint128)',
    'function getDeposit() external view returns (uint256)',
    // Execute functions
    'function execute(address target, uint256 value, bytes calldata data) external',
    'function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata data) external',
    // EntryPoint management
    'function addDeposit() external payable',
    'function withdrawDepositTo(address payable recipient, uint256 amount) external',
    // Whitelist management
    'function setWhiteListedParty(address party, bool status) external',
    'function setWhiteListedPartyBatch(address[] calldata parties, bool[] calldata statuses) external',
    // Ownership
    'function changeOwner(address newOwner) external',
    // Events
    'event ExecutionPerformed(address indexed caller, address indexed target, uint256 value, bytes data)',
    'event BatchExecutionPerformed(address indexed caller, uint256 callCount, uint256 totalValue)',
    'event WhiteListUpdated(address indexed party, bool status)',
    'event EntryPointDepositAdded(uint256 amount, uint256 newBalance)',
    'event EntryPointWithdrawal(address indexed recipient, uint256 amount)'
];
// In-memory conversation history
var conversations = new Map();
var agentContext = new Map();
// ============================================================
// OPENAI FUNCTION DEFINITIONS
// ============================================================
var WALLET_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'send_transaction',
            description: 'Send ETH to a whitelisted address. The address MUST be in the whitelist or the transaction will fail. Use this for single transfers.',
            parameters: {
                type: 'object',
                properties: {
                    to: {
                        type: 'string',
                        description: 'The recipient address (must be whitelisted)'
                    },
                    amount: {
                        type: 'string',
                        description: 'Amount of ETH to send (e.g., "0.1")'
                    },
                    data: {
                        type: 'string',
                        description: 'Optional hex data for contract calls (e.g., "0x")',
                        default: '0x'
                    }
                },
                required: ['to', 'amount']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'batch_transactions',
            description: 'Send ETH to multiple whitelisted addresses in a single transaction. All addresses MUST be whitelisted.',
            parameters: {
                type: 'object',
                properties: {
                    recipients: {
                        type: 'array',
                        description: 'Array of recipients with address and amount',
                        items: {
                            type: 'object',
                            properties: {
                                address: { type: 'string', description: 'Recipient address (must be whitelisted)' },
                                amount: { type: 'string', description: 'ETH amount to send' }
                            },
                            required: ['address', 'amount']
                        }
                    }
                },
                required: ['recipients']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'deposit_gas',
            description: 'Deposit ETH to the EntryPoint for gas. This funds the wallet so it can execute transactions.',
            parameters: {
                type: 'object',
                properties: {
                    amount: {
                        type: 'string',
                        description: 'Amount of ETH to deposit for gas (e.g., "0.1")'
                    }
                },
                required: ['amount']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'withdraw_gas',
            description: 'Withdraw ETH from the EntryPoint deposit back to an address.',
            parameters: {
                type: 'object',
                properties: {
                    recipient: {
                        type: 'string',
                        description: 'Address to receive the withdrawn funds'
                    },
                    amount: {
                        type: 'string',
                        description: 'Amount of ETH to withdraw'
                    }
                },
                required: ['recipient', 'amount']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_to_whitelist',
            description: 'Add an address to the whitelist. Only whitelisted addresses can receive transactions.',
            parameters: {
                type: 'object',
                properties: {
                    address: {
                        type: 'string',
                        description: 'The address to whitelist'
                    }
                },
                required: ['address']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'remove_from_whitelist',
            description: 'Remove an address from the whitelist.',
            parameters: {
                type: 'object',
                properties: {
                    address: {
                        type: 'string',
                        description: 'The address to remove from whitelist'
                    }
                },
                required: ['address']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_wallet_balance',
            description: 'Get the current ETH balance of the wallet and EntryPoint deposit balance.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'check_whitelist',
            description: 'Check if an address is whitelisted.',
            parameters: {
                type: 'object',
                properties: {
                    address: {
                        type: 'string',
                        description: 'Address to check'
                    }
                },
                required: ['address']
            }
        }
    }
];
// ============================================================
// HEALTH & STATUS
// ============================================================
app.get('/', function (req, res) {
    res.json({
        status: 'ok',
        runtime: RUNTIME_ID,
        blockchain: signerWallet ? 'connected' : 'not configured',
        signerAddress: (signerWallet === null || signerWallet === void 0 ? void 0 : signerWallet.address) || null,
        openai_configured: !!OPENAI_API_KEY,
        model: OPENAI_MODEL,
        timestamp: new Date().toISOString()
    });
});
app.get('/health', function (req, res) {
    res.json({ status: 'healthy', runtime: RUNTIME_ID });
});
// ============================================================
// AGENT CONTEXT
// ============================================================
function fetchAgentContext(agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var externalAgentResponse, linkedAgentId, externalAgent, walletsResponse, walletInfo, whitelist, wallets, wallet, whitelistResponse, whitelistData, context_1, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 9, , 10]);
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(AGENTIX_API_URL, "/external/").concat(agentId, "?orgId=").concat(orgId))];
                case 1:
                    externalAgentResponse = _a.sent();
                    linkedAgentId = agentId;
                    if (!externalAgentResponse.ok) return [3 /*break*/, 3];
                    return [4 /*yield*/, externalAgentResponse.json()];
                case 2:
                    externalAgent = _a.sent();
                    linkedAgentId = externalAgent.linkedAgentId || agentId;
                    _a.label = 3;
                case 3: return [4 /*yield*/, (0, node_fetch_1.default)("".concat(AGENTIX_API_URL, "/wallets?orgId=").concat(orgId, "&agentId=").concat(linkedAgentId))];
                case 4:
                    walletsResponse = _a.sent();
                    walletInfo = null;
                    whitelist = [];
                    if (!walletsResponse.ok) return [3 /*break*/, 8];
                    return [4 /*yield*/, walletsResponse.json()];
                case 5:
                    wallets = _a.sent();
                    if (!(wallets && wallets.length > 0)) return [3 /*break*/, 8];
                    wallet = wallets[0];
                    walletInfo = {
                        address: wallet.wallet_address,
                        owner: wallet.owner_address,
                        entryPoint: wallet.entrypoint_address
                    };
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(AGENTIX_API_URL, "/wallets/").concat(wallet.wallet_address, "/whitelist?orgId=").concat(orgId))];
                case 6:
                    whitelistResponse = _a.sent();
                    if (!whitelistResponse.ok) return [3 /*break*/, 8];
                    return [4 /*yield*/, whitelistResponse.json()];
                case 7:
                    whitelistData = _a.sent();
                    if (Array.isArray(whitelistData)) {
                        whitelist = whitelistData.map(function (w) { return w.address || w; });
                    }
                    else if (whitelistData.whitelistedParties) {
                        whitelist = whitelistData.whitelistedParties;
                    }
                    else if (whitelistData.whitelist) {
                        whitelist = whitelistData.whitelist.map(function (w) { return w.address || w; });
                    }
                    _a.label = 8;
                case 8:
                    context_1 = {
                        walletAddress: walletInfo === null || walletInfo === void 0 ? void 0 : walletInfo.address,
                        ownerAddress: walletInfo === null || walletInfo === void 0 ? void 0 : walletInfo.owner,
                        entryPointAddress: walletInfo === null || walletInfo === void 0 ? void 0 : walletInfo.entryPoint,
                        whitelist: whitelist,
                        orgId: orgId,
                        linkedAgentId: linkedAgentId,
                        lastSync: Date.now()
                    };
                    agentContext.set(agentId, context_1);
                    return [2 /*return*/, context_1];
                case 9:
                    error_1 = _a.sent();
                    console.error('[context] Failed to fetch:', error_1);
                    return [2 /*return*/, agentContext.get(agentId) || {}];
                case 10: return [2 /*return*/];
            }
        });
    });
}
function getOnChainBalances(walletAddress) {
    return __awaiter(this, void 0, void 0, function () {
        var walletContract, _a, balanceBN, depositBN, error_2;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!provider || !signerWallet) {
                        return [2 /*return*/, { balance: '0', deposit: '0' }];
                    }
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    walletContract = new ethers_1.ethers.Contract(walletAddress, AGENT_WALLET_ABI, provider);
                    return [4 /*yield*/, Promise.all([
                            walletContract.checkBalance(),
                            walletContract.getDeposit()
                        ])];
                case 2:
                    _a = _b.sent(), balanceBN = _a[0], depositBN = _a[1];
                    return [2 /*return*/, {
                            balance: ethers_1.ethers.formatEther(balanceBN),
                            deposit: ethers_1.ethers.formatEther(depositBN)
                        }];
                case 3:
                    error_2 = _b.sent();
                    console.error('[balance] Error fetching:', error_2);
                    return [2 /*return*/, { balance: '0', deposit: '0' }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// ============================================================
// EXECUTE ENDPOINT
// ============================================================
app.post('/execute', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, action, params, agentId, orgId, _b, error_3;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                _a = req.body, action = _a.action, params = _a.params, agentId = _a.agentId, orgId = _a.orgId;
                console.log("[execute] Action: ".concat(action, ", AgentId: ").concat(agentId));
                _c.label = 1;
            case 1:
                _c.trys.push([1, 22, , 23]);
                _b = action;
                switch (_b) {
                    case 'chat': return [3 /*break*/, 2];
                    case 'send_transaction': return [3 /*break*/, 4];
                    case 'batch_transactions': return [3 /*break*/, 6];
                    case 'deposit_gas': return [3 /*break*/, 8];
                    case 'withdraw_gas': return [3 /*break*/, 10];
                    case 'add_to_whitelist': return [3 /*break*/, 12];
                    case 'remove_from_whitelist': return [3 /*break*/, 14];
                    case 'get_wallet_balance': return [3 /*break*/, 16];
                    case 'check_whitelist': return [3 /*break*/, 18];
                }
                return [3 /*break*/, 20];
            case 2: return [4 /*yield*/, handleChat(req, res, params, agentId, orgId)];
            case 3: return [2 /*return*/, _c.sent()];
            case 4: return [4 /*yield*/, executeSendTransaction(req, res, params, agentId, orgId)];
            case 5: return [2 /*return*/, _c.sent()];
            case 6: return [4 /*yield*/, executeBatchTransactions(req, res, params, agentId, orgId)];
            case 7: return [2 /*return*/, _c.sent()];
            case 8: return [4 /*yield*/, executeDepositGas(req, res, params, agentId, orgId)];
            case 9: return [2 /*return*/, _c.sent()];
            case 10: return [4 /*yield*/, executeWithdrawGas(req, res, params, agentId, orgId)];
            case 11: return [2 /*return*/, _c.sent()];
            case 12: return [4 /*yield*/, executeAddWhitelist(req, res, params, agentId, orgId)];
            case 13: return [2 /*return*/, _c.sent()];
            case 14: return [4 /*yield*/, executeRemoveWhitelist(req, res, params, agentId, orgId)];
            case 15: return [2 /*return*/, _c.sent()];
            case 16: return [4 /*yield*/, executeGetBalance(req, res, agentId, orgId)];
            case 17: return [2 /*return*/, _c.sent()];
            case 18: return [4 /*yield*/, executeCheckWhitelist(req, res, params, agentId, orgId)];
            case 19: return [2 /*return*/, _c.sent()];
            case 20: return [2 /*return*/, res.json({
                    success: false,
                    error: "Unknown action: ".concat(action),
                    availableActions: ['chat', 'send_transaction', 'batch_transactions', 'deposit_gas', 'withdraw_gas', 'add_to_whitelist', 'remove_from_whitelist', 'get_wallet_balance', 'check_whitelist']
                })];
            case 21: return [3 /*break*/, 23];
            case 22:
                error_3 = _c.sent();
                console.error('[execute] Error:', error_3);
                return [2 /*return*/, res.status(500).json({ success: false, error: error_3.message })];
            case 23: return [2 /*return*/];
        }
    });
}); });
// ============================================================
// CHAT HANDLER WITH FUNCTION CALLING
// ============================================================
function handleChat(req, res, params, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var message, ctx, balances, convId, history, systemPrompt, messages, response, assistantMessage, _i, _a, toolCall, functionName, functionArgs, result, error_4;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    message = params.message;
                    if (!message) {
                        return [2 /*return*/, res.status(400).json({ success: false, error: 'Message is required' })];
                    }
                    if (!OPENAI_API_KEY) {
                        return [2 /*return*/, res.status(503).json({
                                success: false,
                                error: 'OpenAI API key not configured'
                            })];
                    }
                    return [4 /*yield*/, fetchAgentContext(agentId || '1', orgId || 1)
                        // Get on-chain balances
                    ];
                case 1:
                    ctx = _c.sent();
                    balances = { balance: '0', deposit: '0' };
                    if (!ctx.walletAddress) return [3 /*break*/, 3];
                    return [4 /*yield*/, getOnChainBalances(ctx.walletAddress)];
                case 2:
                    balances = _c.sent();
                    ctx.balance = balances.balance;
                    ctx.depositBalance = balances.deposit;
                    _c.label = 3;
                case 3:
                    convId = agentId || 'default';
                    if (!conversations.has(convId)) {
                        conversations.set(convId, []);
                    }
                    history = conversations.get(convId);
                    systemPrompt = buildSystemPrompt(ctx);
                    messages = __spreadArray(__spreadArray([
                        { role: 'system', content: systemPrompt }
                    ], history, true), [
                        { role: 'user', content: message }
                    ], false);
                    _c.label = 4;
                case 4:
                    _c.trys.push([4, 13, , 14]);
                    return [4 /*yield*/, callOpenAI(messages)];
                case 5:
                    response = _c.sent();
                    assistantMessage = response.choices[0].message;
                    _c.label = 6;
                case 6:
                    if (!(assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0)) return [3 /*break*/, 12];
                    // Add assistant message with tool calls to history
                    messages.push({
                        role: 'assistant',
                        content: assistantMessage.content,
                        tool_calls: assistantMessage.tool_calls
                    });
                    _i = 0, _a = assistantMessage.tool_calls;
                    _c.label = 7;
                case 7:
                    if (!(_i < _a.length)) return [3 /*break*/, 10];
                    toolCall = _a[_i];
                    functionName = toolCall.function.name;
                    functionArgs = JSON.parse(toolCall.function.arguments);
                    console.log("[tool] Calling ".concat(functionName, " with args:"), functionArgs);
                    return [4 /*yield*/, executeWalletFunction(ctx, functionName, functionArgs, agentId, orgId)
                        // Add tool result
                    ];
                case 8:
                    result = _c.sent();
                    // Add tool result
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result)
                    });
                    _c.label = 9;
                case 9:
                    _i++;
                    return [3 /*break*/, 7];
                case 10: return [4 /*yield*/, callOpenAI(messages)];
                case 11:
                    // Call API again with tool results
                    response = _c.sent();
                    assistantMessage = response.choices[0].message;
                    return [3 /*break*/, 6];
                case 12:
                    // Add messages to history (keep last 20)
                    history.push({ role: 'user', content: message });
                    if (assistantMessage.content) {
                        history.push({ role: 'assistant', content: assistantMessage.content });
                    }
                    if (history.length > 20) {
                        history.splice(0, history.length - 20);
                    }
                    return [2 /*return*/, res.json({
                            success: true,
                            response: assistantMessage.content,
                            walletContext: {
                                hasWallet: !!ctx.walletAddress,
                                walletAddress: ctx.walletAddress,
                                balance: balances.balance,
                                depositBalance: balances.deposit,
                                whitelistCount: ((_b = ctx.whitelist) === null || _b === void 0 ? void 0 : _b.length) || 0
                            }
                        })];
                case 13:
                    error_4 = _c.sent();
                    console.error('[chat] Error:', error_4);
                    return [2 /*return*/, res.status(502).json({ success: false, error: error_4.message })];
                case 14: return [2 /*return*/];
            }
        });
    });
}
function callOpenAI(messages) {
    return __awaiter(this, void 0, void 0, function () {
        var response, errorText;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, node_fetch_1.default)("".concat(OPENAI_API_URL, "/chat/completions"), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': "Bearer ".concat(OPENAI_API_KEY)
                        },
                        body: JSON.stringify({
                            model: OPENAI_MODEL,
                            max_tokens: 4096,
                            messages: messages,
                            tools: WALLET_TOOLS,
                            tool_choice: 'auto'
                        })
                    })];
                case 1:
                    response = _a.sent();
                    if (!!response.ok) return [3 /*break*/, 3];
                    return [4 /*yield*/, response.text()];
                case 2:
                    errorText = _a.sent();
                    throw new Error("API error ".concat(response.status, ": ").concat(errorText));
                case 3: return [2 /*return*/, response.json()];
            }
        });
    });
}
// ============================================================
// WALLET FUNCTION EXECUTOR
// ============================================================
function executeWalletFunction(ctx, functionName, args, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = functionName;
                    switch (_a) {
                        case 'send_transaction': return [3 /*break*/, 1];
                        case 'batch_transactions': return [3 /*break*/, 3];
                        case 'deposit_gas': return [3 /*break*/, 5];
                        case 'withdraw_gas': return [3 /*break*/, 7];
                        case 'add_to_whitelist': return [3 /*break*/, 9];
                        case 'remove_from_whitelist': return [3 /*break*/, 11];
                        case 'get_wallet_balance': return [3 /*break*/, 13];
                        case 'check_whitelist': return [3 /*break*/, 15];
                    }
                    return [3 /*break*/, 17];
                case 1: return [4 /*yield*/, executeSendTransactionDirect(ctx, args, agentId, orgId)];
                case 2: return [2 /*return*/, _b.sent()];
                case 3: return [4 /*yield*/, executeBatchTransactionsDirect(ctx, args, agentId, orgId)];
                case 4: return [2 /*return*/, _b.sent()];
                case 5: return [4 /*yield*/, executeDepositGasDirect(ctx, args, agentId, orgId)];
                case 6: return [2 /*return*/, _b.sent()];
                case 7: return [4 /*yield*/, executeWithdrawGasDirect(ctx, args, agentId, orgId)];
                case 8: return [2 /*return*/, _b.sent()];
                case 9: return [4 /*yield*/, executeAddWhitelistDirect(ctx, args, agentId, orgId)];
                case 10: return [2 /*return*/, _b.sent()];
                case 11: return [4 /*yield*/, executeRemoveWhitelistDirect(ctx, args, agentId, orgId)];
                case 12: return [2 /*return*/, _b.sent()];
                case 13: return [4 /*yield*/, executeGetBalanceDirect(ctx, agentId, orgId)];
                case 14: return [2 /*return*/, _b.sent()];
                case 15: return [4 /*yield*/, executeCheckWhitelistDirect(ctx, args, agentId, orgId)];
                case 16: return [2 /*return*/, _b.sent()];
                case 17: return [2 /*return*/, { success: false, error: "Unknown function: ".concat(functionName) }];
            }
        });
    });
}
// ============================================================
// BLOCKCHAIN EXECUTION FUNCTIONS
// ============================================================
function executeSendTransactionDirect(ctx, args, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var isWhitelisted, walletContract, owner, valueWei, data, tx, receipt, error_5;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!signerWallet || !provider) {
                        return [2 /*return*/, { success: false, error: 'Blockchain not configured' }];
                    }
                    if (!ctx.walletAddress) {
                        return [2 /*return*/, { success: false, error: 'No wallet configured' }];
                    }
                    isWhitelisted = (_a = ctx.whitelist) === null || _a === void 0 ? void 0 : _a.some(function (w) { return w.toLowerCase() === args.to.toLowerCase(); });
                    if (!isWhitelisted) {
                        return [2 /*return*/, {
                                success: false,
                                error: "Address ".concat(args.to, " is not whitelisted"),
                                whitelist: ctx.whitelist
                            }];
                    }
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 5, , 6]);
                    walletContract = new ethers_1.ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet);
                    return [4 /*yield*/, walletContract.owner()];
                case 2:
                    owner = _b.sent();
                    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
                        return [2 /*return*/, {
                                success: false,
                                error: "Runtime wallet ".concat(signerWallet.address, " is not the owner of ").concat(ctx.walletAddress),
                                owner: owner
                            }];
                    }
                    valueWei = ethers_1.ethers.parseEther(args.amount);
                    data = args.data || '0x';
                    console.log("[tx] Executing: send ".concat(args.amount, " ETH to ").concat(args.to));
                    return [4 /*yield*/, walletContract.execute(args.to, valueWei, data)];
                case 3:
                    tx = _b.sent();
                    console.log("[tx] Sent: ".concat(tx.hash));
                    return [4 /*yield*/, tx.wait()];
                case 4:
                    receipt = _b.sent();
                    return [2 /*return*/, {
                            success: true,
                            txHash: tx.hash,
                            to: args.to,
                            amount: args.amount,
                            from: ctx.walletAddress,
                            blockNumber: receipt.blockNumber,
                            message: "Successfully sent ".concat(args.amount, " ETH to ").concat(args.to)
                        }];
                case 5:
                    error_5 = _b.sent();
                    console.error('[tx] Error:', error_5);
                    return [2 /*return*/, { success: false, error: error_5.message || 'Transaction failed' }];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function executeBatchTransactionsDirect(ctx, args, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var targets, values, dataArray, totalEth, _loop_1, _i, _a, recipient, state_1, walletContract, owner, tx, receipt, error_6;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!signerWallet || !provider) {
                        return [2 /*return*/, { success: false, error: 'Blockchain not configured' }];
                    }
                    if (!ctx.walletAddress) {
                        return [2 /*return*/, { success: false, error: 'No wallet configured' }];
                    }
                    targets = [];
                    values = [];
                    dataArray = [];
                    totalEth = 0;
                    _loop_1 = function (recipient) {
                        // Check whitelist
                        var isWhitelisted = (_b = ctx.whitelist) === null || _b === void 0 ? void 0 : _b.some(function (w) { return w.toLowerCase() === recipient.address.toLowerCase(); });
                        if (!isWhitelisted) {
                            return { value: {
                                    success: false,
                                    error: "Address ".concat(recipient.address, " is not whitelisted"),
                                    whitelist: ctx.whitelist
                                } };
                        }
                        targets.push(recipient.address);
                        var valueWei = ethers_1.ethers.parseEther(recipient.amount);
                        values.push(valueWei);
                        dataArray.push('0x');
                        totalEth += parseFloat(recipient.amount);
                    };
                    for (_i = 0, _a = args.recipients; _i < _a.length; _i++) {
                        recipient = _a[_i];
                        state_1 = _loop_1(recipient);
                        if (typeof state_1 === "object")
                            return [2 /*return*/, state_1.value];
                    }
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 5, , 6]);
                    walletContract = new ethers_1.ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet);
                    return [4 /*yield*/, walletContract.owner()];
                case 2:
                    owner = _c.sent();
                    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
                        return [2 /*return*/, { success: false, error: 'Not wallet owner' }];
                    }
                    console.log("[tx] Batch executing: ".concat(targets.length, " transactions, total ").concat(totalEth, " ETH"));
                    return [4 /*yield*/, walletContract.executeBatch(targets, values, dataArray)];
                case 3:
                    tx = _c.sent();
                    console.log("[tx] Sent: ".concat(tx.hash));
                    return [4 /*yield*/, tx.wait()];
                case 4:
                    receipt = _c.sent();
                    return [2 /*return*/, {
                            success: true,
                            txHash: tx.hash,
                            recipients: args.recipients,
                            totalAmount: totalEth.toString(),
                            from: ctx.walletAddress,
                            blockNumber: receipt.blockNumber,
                            message: "Successfully sent ".concat(totalEth, " ETH to ").concat(targets.length, " addresses")
                        }];
                case 5:
                    error_6 = _c.sent();
                    console.error('[tx] Batch error:', error_6);
                    return [2 /*return*/, { success: false, error: error_6.message || 'Batch transaction failed' }];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function executeDepositGasDirect(ctx, args, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var walletContract, owner, amountWei, tx, receipt, newDeposit, error_7;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!signerWallet || !provider) {
                        return [2 /*return*/, { success: false, error: 'Blockchain not configured' }];
                    }
                    if (!ctx.walletAddress) {
                        return [2 /*return*/, { success: false, error: 'No wallet configured' }];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 6, , 7]);
                    walletContract = new ethers_1.ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet);
                    return [4 /*yield*/, walletContract.owner()];
                case 2:
                    owner = _a.sent();
                    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
                        return [2 /*return*/, { success: false, error: 'Not wallet owner' }];
                    }
                    amountWei = ethers_1.ethers.parseEther(args.amount);
                    console.log("[tx] Depositing ".concat(args.amount, " ETH to EntryPoint"));
                    return [4 /*yield*/, walletContract.addDeposit({ value: amountWei })];
                case 3:
                    tx = _a.sent();
                    console.log("[tx] Sent: ".concat(tx.hash));
                    return [4 /*yield*/, tx.wait()
                        // Get new deposit balance
                    ];
                case 4:
                    receipt = _a.sent();
                    return [4 /*yield*/, walletContract.getDeposit()];
                case 5:
                    newDeposit = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            txHash: tx.hash,
                            amount: args.amount,
                            newDepositBalance: ethers_1.ethers.formatEther(newDeposit),
                            message: "Deposited ".concat(args.amount, " ETH to EntryPoint. New balance: ").concat(ethers_1.ethers.formatEther(newDeposit), " ETH")
                        }];
                case 6:
                    error_7 = _a.sent();
                    console.error('[tx] Deposit error:', error_7);
                    return [2 /*return*/, { success: false, error: error_7.message || 'Deposit failed' }];
                case 7: return [2 /*return*/];
            }
        });
    });
}
function executeWithdrawGasDirect(ctx, args, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var walletContract, owner, amountWei, tx, receipt, error_8;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!signerWallet || !provider) {
                        return [2 /*return*/, { success: false, error: 'Blockchain not configured' }];
                    }
                    if (!ctx.walletAddress) {
                        return [2 /*return*/, { success: false, error: 'No wallet configured' }];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    walletContract = new ethers_1.ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet);
                    return [4 /*yield*/, walletContract.owner()];
                case 2:
                    owner = _a.sent();
                    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
                        return [2 /*return*/, { success: false, error: 'Not wallet owner' }];
                    }
                    amountWei = ethers_1.ethers.parseEther(args.amount);
                    console.log("[tx] Withdrawing ".concat(args.amount, " ETH from EntryPoint to ").concat(args.recipient));
                    return [4 /*yield*/, walletContract.withdrawDepositTo(args.recipient, amountWei)];
                case 3:
                    tx = _a.sent();
                    console.log("[tx] Sent: ".concat(tx.hash));
                    return [4 /*yield*/, tx.wait()];
                case 4:
                    receipt = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            txHash: tx.hash,
                            amount: args.amount,
                            recipient: args.recipient,
                            message: "Withdrew ".concat(args.amount, " ETH from EntryPoint to ").concat(args.recipient)
                        }];
                case 5:
                    error_8 = _a.sent();
                    console.error('[tx] Withdraw error:', error_8);
                    return [2 /*return*/, { success: false, error: error_8.message || 'Withdrawal failed' }];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function executeAddWhitelistDirect(ctx, args, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var walletContract, owner, tx, receipt, error_9;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!signerWallet || !provider) {
                        return [2 /*return*/, { success: false, error: 'Blockchain not configured' }];
                    }
                    if (!ctx.walletAddress) {
                        return [2 /*return*/, { success: false, error: 'No wallet configured' }];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    walletContract = new ethers_1.ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet);
                    return [4 /*yield*/, walletContract.owner()];
                case 2:
                    owner = _a.sent();
                    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
                        return [2 /*return*/, { success: false, error: 'Not wallet owner' }];
                    }
                    console.log("[tx] Adding ".concat(args.address, " to whitelist"));
                    return [4 /*yield*/, walletContract.setWhiteListedParty(args.address, true)];
                case 3:
                    tx = _a.sent();
                    console.log("[tx] Sent: ".concat(tx.hash));
                    return [4 /*yield*/, tx.wait()
                        // Update context
                    ];
                case 4:
                    receipt = _a.sent();
                    // Update context
                    ctx.whitelist = __spreadArray(__spreadArray([], (ctx.whitelist || []), true), [args.address], false);
                    return [2 /*return*/, {
                            success: true,
                            txHash: tx.hash,
                            address: args.address,
                            message: "Added ".concat(args.address, " to whitelist")
                        }];
                case 5:
                    error_9 = _a.sent();
                    console.error('[tx] Whitelist add error:', error_9);
                    return [2 /*return*/, { success: false, error: error_9.message || 'Failed to add to whitelist' }];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function executeRemoveWhitelistDirect(ctx, args, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var walletContract, owner, tx, receipt, error_10;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!signerWallet || !provider) {
                        return [2 /*return*/, { success: false, error: 'Blockchain not configured' }];
                    }
                    if (!ctx.walletAddress) {
                        return [2 /*return*/, { success: false, error: 'No wallet configured' }];
                    }
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 5, , 6]);
                    walletContract = new ethers_1.ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet);
                    return [4 /*yield*/, walletContract.owner()];
                case 2:
                    owner = _b.sent();
                    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
                        return [2 /*return*/, { success: false, error: 'Not wallet owner' }];
                    }
                    console.log("[tx] Removing ".concat(args.address, " from whitelist"));
                    return [4 /*yield*/, walletContract.setWhiteListedParty(args.address, false)];
                case 3:
                    tx = _b.sent();
                    console.log("[tx] Sent: ".concat(tx.hash));
                    return [4 /*yield*/, tx.wait()
                        // Update context
                    ];
                case 4:
                    receipt = _b.sent();
                    // Update context
                    ctx.whitelist = ((_a = ctx.whitelist) === null || _a === void 0 ? void 0 : _a.filter(function (w) { return w.toLowerCase() !== args.address.toLowerCase(); })) || [];
                    return [2 /*return*/, {
                            success: true,
                            txHash: tx.hash,
                            address: args.address,
                            message: "Removed ".concat(args.address, " from whitelist")
                        }];
                case 5:
                    error_10 = _b.sent();
                    console.error('[tx] Whitelist remove error:', error_10);
                    return [2 /*return*/, { success: false, error: error_10.message || 'Failed to remove from whitelist' }];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function executeGetBalanceDirect(ctx, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var balances;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!ctx.walletAddress) {
                        return [2 /*return*/, { success: false, error: 'No wallet configured' }];
                    }
                    return [4 /*yield*/, getOnChainBalances(ctx.walletAddress)];
                case 1:
                    balances = _b.sent();
                    return [2 /*return*/, {
                            success: true,
                            walletAddress: ctx.walletAddress,
                            balance: balances.balance,
                            depositBalance: balances.deposit,
                            whitelist: ctx.whitelist,
                            whitelistCount: ((_a = ctx.whitelist) === null || _a === void 0 ? void 0 : _a.length) || 0
                        }];
            }
        });
    });
}
function executeCheckWhitelistDirect(ctx, args, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var isWhitelisted;
        var _a;
        return __generator(this, function (_b) {
            if (!ctx.walletAddress) {
                return [2 /*return*/, { success: false, error: 'No wallet configured' }];
            }
            isWhitelisted = ((_a = ctx.whitelist) === null || _a === void 0 ? void 0 : _a.some(function (w) { return w.toLowerCase() === args.address.toLowerCase(); })) || false;
            return [2 /*return*/, {
                    success: true,
                    address: args.address,
                    isWhitelisted: isWhitelisted,
                    walletAddress: ctx.walletAddress
                }];
        });
    });
}
// ============================================================
// HTTP ENDPOINT WRAPPERS (for direct calls)
// ============================================================
function executeSendTransaction(req, res, params, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var ctx, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetchAgentContext(agentId, orgId)];
                case 1:
                    ctx = _a.sent();
                    return [4 /*yield*/, executeSendTransactionDirect(ctx, params, agentId, orgId)];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, res.json(__assign(__assign({}, result), { type: 'transaction' }))];
            }
        });
    });
}
function executeBatchTransactions(req, res, params, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var ctx, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetchAgentContext(agentId, orgId)];
                case 1:
                    ctx = _a.sent();
                    return [4 /*yield*/, executeBatchTransactionsDirect(ctx, params, agentId, orgId)];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, res.json(__assign(__assign({}, result), { type: 'batch_transaction' }))];
            }
        });
    });
}
function executeDepositGas(req, res, params, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var ctx, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetchAgentContext(agentId, orgId)];
                case 1:
                    ctx = _a.sent();
                    return [4 /*yield*/, executeDepositGasDirect(ctx, params, agentId, orgId)];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, res.json(__assign(__assign({}, result), { type: 'deposit' }))];
            }
        });
    });
}
function executeWithdrawGas(req, res, params, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var ctx, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetchAgentContext(agentId, orgId)];
                case 1:
                    ctx = _a.sent();
                    return [4 /*yield*/, executeWithdrawGasDirect(ctx, params, agentId, orgId)];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, res.json(__assign(__assign({}, result), { type: 'withdrawal' }))];
            }
        });
    });
}
function executeAddWhitelist(req, res, params, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var ctx, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetchAgentContext(agentId, orgId)];
                case 1:
                    ctx = _a.sent();
                    return [4 /*yield*/, executeAddWhitelistDirect(ctx, params, agentId, orgId)];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, res.json(__assign(__assign({}, result), { type: 'whitelist_add' }))];
            }
        });
    });
}
function executeRemoveWhitelist(req, res, params, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var ctx, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetchAgentContext(agentId, orgId)];
                case 1:
                    ctx = _a.sent();
                    return [4 /*yield*/, executeRemoveWhitelistDirect(ctx, params, agentId, orgId)];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, res.json(__assign(__assign({}, result), { type: 'whitelist_remove' }))];
            }
        });
    });
}
function executeGetBalance(req, res, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var ctx, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetchAgentContext(agentId, orgId)];
                case 1:
                    ctx = _a.sent();
                    return [4 /*yield*/, executeGetBalanceDirect(ctx, agentId, orgId)];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, res.json(result)];
            }
        });
    });
}
function executeCheckWhitelist(req, res, params, agentId, orgId) {
    return __awaiter(this, void 0, void 0, function () {
        var ctx, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetchAgentContext(agentId, orgId)];
                case 1:
                    ctx = _a.sent();
                    return [4 /*yield*/, executeCheckWhitelistDirect(ctx, params, agentId, orgId)];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, res.json(result)];
            }
        });
    });
}
// ============================================================
// SYSTEM PROMPT
// ============================================================
function buildSystemPrompt(ctx) {
    var _a;
    var prompt = "You are an AI agent operating under the Agentix Protocol. You have access to a blockchain wallet and can execute transactions ONLY to whitelisted addresses.\n\n## Your Wallet Tools\n\nYou have these tools available:\n\n### Transactions\n- **send_transaction**: Send ETH to a single whitelisted address\n- **batch_transactions**: Send ETH to multiple whitelisted addresses at once\n\n### Gas Management\n- **deposit_gas**: Add ETH to the EntryPoint for transaction gas\n- **withdraw_gas**: Withdraw ETH from EntryPoint deposit\n\n### Whitelist Management\n- **add_to_whitelist**: Allow an address to receive transactions\n- **remove_from_whitelist**: Remove address from allowed list\n\n### Information\n- **get_wallet_balance**: Check wallet and deposit balances\n- **check_whitelist**: Verify if an address is whitelisted\n\n## Rules\n\n1. ALWAYS verify the recipient is whitelisted before sending\n2. Ask for confirmation before executing transactions\n3. Explain what you're about to do clearly\n4. If recipient is not whitelisted, offer to add them\n\n## Current Context\n\n### Wallet\n- Address: ".concat(ctx.walletAddress || 'Not configured', "\n- Owner: ").concat(ctx.ownerAddress || 'Unknown', "\n- Balance: ").concat(ctx.balance || '0', " ETH\n- Gas Deposit: ").concat(ctx.depositBalance || '0', " ETH\n\n### Whitelist (").concat(((_a = ctx.whitelist) === null || _a === void 0 ? void 0 : _a.length) || 0, " addresses)\n").concat(ctx.whitelist && ctx.whitelist.length > 0
        ? ctx.whitelist.slice(0, 10).map(function (w) { return "- ".concat(w); }).join('\n') + (ctx.whitelist.length > 10 ? "\n... and ".concat(ctx.whitelist.length - 10, " more") : '')
        : '- No addresses whitelisted', "\n");
    return prompt;
}
// ============================================================
// START SERVER
// ============================================================
app.listen(RUNTIME_PORT, function () {
    console.log("\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557\n\u2551  Agentix Runtime Server (with Function Calling)              \u2551\n\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563\n\u2551  Port: ".concat(RUNTIME_PORT, "                                                 \u2551\n\u2551  Runtime ID: ").concat(RUNTIME_ID, "                                  \u2551\n\u2551  Blockchain: ").concat(signerWallet ? '✓ Connected' : '✗ Not configured', "                                \u2551\n\u2551  Signer: ").concat(signerWallet ? signerWallet.address.slice(0, 20) + '...' : 'N/A', "                              \u2551\n\u2551  OpenAI: ").concat(OPENAI_API_KEY ? '✓ Configured' : '✗ Not configured', "                                    \u2551\n\u2551  Model: ").concat(OPENAI_MODEL, "                                        \u2551\n\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563\n\u2551  Available Functions:                                        \u2551\n\u2551  - send_transaction    (single transfer)                     \u2551\n\u2551  - batch_transactions  (multiple transfers)                  \u2551\n\u2551  - deposit_gas         (fund EntryPoint)                     \u2551\n\u2551  - withdraw_gas        (withdraw from EntryPoint)            \u2551\n\u2551  - add_to_whitelist    (allow address)                       \u2551\n\u2551  - remove_from_whitelist (block address)                     \u2551\n\u2551  - get_wallet_balance  (check balance)                       \u2551\n\u2551  - check_whitelist     (verify address)                      \u2551\n\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\n"));
});
