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

import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import fetch from 'node-fetch'
import { ethers } from 'ethers'

config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// Configuration
const RUNTIME_ID = process.env.RUNTIME_ID || 'local-runtime-001'
const RUNTIME_PORT = process.env.RUNTIME_PORT || 3002
const AGENTIX_API_URL = process.env.AGENTIX_API_URL || 'http://localhost:3001'

// OpenAI API Configuration
const OPENAI_API_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'zai.glm-5'

// Blockchain Configuration
const RPC_URL = process.env.RPC_URL || ''
const PRIVATE_KEY = process.env.PRIVATE_KEY || ''
const CHAIN_ID = Number(process.env.CHAIN_ID || '84532')

// Initialize provider and wallet
let provider: ethers.JsonRpcProvider | null = null
let signerWallet: ethers.Wallet | null = null

if (PRIVATE_KEY && RPC_URL) {
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL)
    signerWallet = new ethers.Wallet(PRIVATE_KEY, provider)
    console.log(`[blockchain] Initialized with address: ${signerWallet.address}`)
  } catch (error) {
    console.error('[blockchain] Failed to initialize wallet:', error)
  }
}

// Full AgentWallet ABI
const AGENT_WALLET_ABI = [
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
  'event ExecutionPerformed(address indexed caller, address indexed target, uint256 value, bytes32 dataHash)',
  'event BatchExecutionPerformed(address indexed caller, uint256 callCount, uint256 totalValue)',
  'event WhiteListUpdated(address indexed party, bool status)',
  'event EntryPointDepositAdded(uint256 amount, uint256 newBalance)',
  'event EntryPointWithdrawal(address indexed recipient, uint256 amount)'
]

// In-memory conversation history
const conversations: Map<string, Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }>> = new Map()

// Agent context cache
interface AgentContext {
  walletAddress?: string
  ownerAddress?: string
  entryPointAddress?: string
  whitelist?: string[]
  balance?: string
  depositBalance?: string
  orgId?: number
  linkedAgentId?: string
  lastSync?: number
}

const agentContext: Map<string, AgentContext> = new Map()

// ============================================================
// OPENAI FUNCTION DEFINITIONS
// ============================================================

const WALLET_TOOLS = [
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
]

// ============================================================
// HEALTH & STATUS
// ============================================================

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    runtime: RUNTIME_ID,
    blockchain: signerWallet ? 'connected' : 'not configured',
    signerAddress: signerWallet?.address || null,
    openai_configured: !!OPENAI_API_KEY,
    model: OPENAI_MODEL,
    timestamp: new Date().toISOString()
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', runtime: RUNTIME_ID })
})

// ============================================================
// AGENT CONTEXT
// ============================================================

async function fetchAgentContext(agentId: string, orgId: number): Promise<AgentContext> {
  try {
    const externalAgentResponse = await fetch(`${AGENTIX_API_URL}/external/${agentId}?orgId=${orgId}`)
    let linkedAgentId = agentId

    if (externalAgentResponse.ok) {
      const externalAgent = await externalAgentResponse.json()
      linkedAgentId = externalAgent.linkedAgentId || agentId
    }

    const walletsResponse = await fetch(`${AGENTIX_API_URL}/wallets?orgId=${orgId}&agentId=${linkedAgentId}`)
    let walletInfo: { address: string; owner: string; entryPoint?: string } | null = null
    let whitelist: string[] = []

    if (walletsResponse.ok) {
      const wallets = await walletsResponse.json()
      if (wallets && wallets.length > 0) {
        const wallet = wallets[0]
        walletInfo = {
          address: wallet.wallet_address,
          owner: wallet.owner_address,
          entryPoint: wallet.entrypoint_address
        }

        const whitelistResponse = await fetch(
          `${AGENTIX_API_URL}/wallets/${wallet.wallet_address}/whitelist?orgId=${orgId}`
        )
        if (whitelistResponse.ok) {
          const whitelistData = await whitelistResponse.json()
          if (Array.isArray(whitelistData)) {
            whitelist = whitelistData.map((w: any) => w.address || w)
          } else if (whitelistData.whitelistedParties) {
            whitelist = whitelistData.whitelistedParties
          } else if (whitelistData.whitelist) {
            whitelist = whitelistData.whitelist.map((w: any) => w.address || w)
          }
        }
      }
    }

    const context: AgentContext = {
      walletAddress: walletInfo?.address,
      ownerAddress: walletInfo?.owner,
      entryPointAddress: walletInfo?.entryPoint,
      whitelist,
      orgId,
      linkedAgentId,
      lastSync: Date.now()
    }

    agentContext.set(agentId, context)
    return context
  } catch (error) {
    console.error('[context] Failed to fetch:', error)
    return agentContext.get(agentId) || {}
  }
}

async function getOnChainBalances(walletAddress: string): Promise<{ balance: string; deposit: string }> {
  if (!provider || !signerWallet) {
    return { balance: '0', deposit: '0' }
  }

  try {
    const walletContract = new ethers.Contract(walletAddress, AGENT_WALLET_ABI, provider)

    const [balanceBN, depositBN] = await Promise.all([
      walletContract.checkBalance(),
      walletContract.getDeposit()
    ])

    return {
      balance: ethers.formatEther(balanceBN),
      deposit: ethers.formatEther(depositBN)
    }
  } catch (error) {
    console.error('[balance] Error fetching:', error)
    return { balance: '0', deposit: '0' }
  }
}

// ============================================================
// EXECUTE ENDPOINT
// ============================================================

app.post('/execute', async (req, res) => {
  const { action, params, agentId, orgId } = req.body

  console.log(`[execute] Action: ${action}, AgentId: ${agentId}`)

  try {
    switch (action) {
      case 'chat':
        return await handleChat(req, res, params, agentId, orgId)

      case 'send_transaction':
        return await executeSendTransaction(req, res, params, agentId, orgId)

      case 'batch_transactions':
        return await executeBatchTransactions(req, res, params, agentId, orgId)

      case 'deposit_gas':
        return await executeDepositGas(req, res, params, agentId, orgId)

      case 'withdraw_gas':
        return await executeWithdrawGas(req, res, params, agentId, orgId)

      case 'add_to_whitelist':
        return await executeAddWhitelist(req, res, params, agentId, orgId)

      case 'remove_from_whitelist':
        return await executeRemoveWhitelist(req, res, params, agentId, orgId)

      case 'get_wallet_balance':
        return await executeGetBalance(req, res, agentId, orgId)

      case 'check_whitelist':
        return await executeCheckWhitelist(req, res, params, agentId, orgId)

      default:
        return res.json({
          success: false,
          error: `Unknown action: ${action}`,
          availableActions: ['chat', 'send_transaction', 'batch_transactions', 'deposit_gas', 'withdraw_gas', 'add_to_whitelist', 'remove_from_whitelist', 'get_wallet_balance', 'check_whitelist']
        })
    }
  } catch (error: any) {
    console.error('[execute] Error:', error)
    return res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================
// CHAT HANDLER WITH FUNCTION CALLING
// ============================================================

async function handleChat(
  req: express.Request,
  res: express.Response,
  params: any,
  agentId: string,
  orgId: number
) {
  const { message } = params

  if (!message) {
    return res.status(400).json({ success: false, error: 'Message is required' })
  }

  if (!OPENAI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'OpenAI API key not configured'
    })
  }

  // Fetch agent context
  const ctx = await fetchAgentContext(agentId || '1', orgId || 1)

  // Get on-chain balances
  let balances = { balance: '0', deposit: '0' }
  if (ctx.walletAddress) {
    balances = await getOnChainBalances(ctx.walletAddress)
    ctx.balance = balances.balance
    ctx.depositBalance = balances.deposit
  }

  // Get conversation history
  const convId = agentId || 'default'
  if (!conversations.has(convId)) {
    conversations.set(convId, [])
  }
  const history = conversations.get(convId)!

  // Build system prompt
  const systemPrompt = buildSystemPrompt(ctx)

  // Build messages
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message }
  ]

  try {
    // First API call - may return tool calls
    let response = await callOpenAI(messages)
    let assistantMessage = response.choices[0].message

    // Handle tool calls
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // Add assistant message with tool calls to history
      messages.push({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: assistantMessage.tool_calls
      })

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const functionName = toolCall.function.name
        const functionArgs = JSON.parse(toolCall.function.arguments)

        console.log(`[tool] Calling ${functionName} with args:`, functionArgs)

        // Execute the function
        const result = await executeWalletFunction(ctx, functionName, functionArgs, agentId, orgId)

        // Add tool result
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        })
      }

      // Call API again with tool results
      response = await callOpenAI(messages)
      assistantMessage = response.choices[0].message
    }

    // Add messages to history (keep last 20)
    history.push({ role: 'user', content: message })
    if (assistantMessage.content) {
      history.push({ role: 'assistant', content: assistantMessage.content })
    }
    if (history.length > 20) {
      history.splice(0, history.length - 20)
    }

    return res.json({
      success: true,
      response: assistantMessage.content,
      walletContext: {
        hasWallet: !!ctx.walletAddress,
        walletAddress: ctx.walletAddress,
        balance: balances.balance,
        depositBalance: balances.deposit,
        whitelistCount: ctx.whitelist?.length || 0
      }
    })

  } catch (error: any) {
    console.error('[chat] Error:', error)
    return res.status(502).json({ success: false, error: error.message })
  }
}

async function callOpenAI(messages: any[]): Promise<any> {
  const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 4096,
      messages,
      tools: WALLET_TOOLS,
      tool_choice: 'auto'
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error ${response.status}: ${errorText}`)
  }

  return response.json()
}

// ============================================================
// WALLET FUNCTION EXECUTOR
// ============================================================

async function executeWalletFunction(
  ctx: AgentContext,
  functionName: string,
  args: any,
  agentId: string,
  orgId: number
): Promise<any> {
  switch (functionName) {
    case 'send_transaction':
      return await executeSendTransactionDirect(ctx, args, agentId, orgId)

    case 'batch_transactions':
      return await executeBatchTransactionsDirect(ctx, args, agentId, orgId)

    case 'deposit_gas':
      return await executeDepositGasDirect(ctx, args, agentId, orgId)

    case 'withdraw_gas':
      return await executeWithdrawGasDirect(ctx, args, agentId, orgId)

    case 'add_to_whitelist':
      return await executeAddWhitelistDirect(ctx, args, agentId, orgId)

    case 'remove_from_whitelist':
      return await executeRemoveWhitelistDirect(ctx, args, agentId, orgId)

    case 'get_wallet_balance':
      return await executeGetBalanceDirect(ctx, agentId, orgId)

    case 'check_whitelist':
      return await executeCheckWhitelistDirect(ctx, args, agentId, orgId)

    default:
      return { success: false, error: `Unknown function: ${functionName}` }
  }
}

// ============================================================
// BLOCKCHAIN EXECUTION FUNCTIONS
// ============================================================

async function executeSendTransactionDirect(
  ctx: AgentContext,
  args: { to: string; amount: string; data?: string },
  agentId: string,
  orgId: number
): Promise<any> {
  if (!signerWallet || !provider) {
    return { success: false, error: 'Blockchain not configured' }
  }

  if (!ctx.walletAddress) {
    return { success: false, error: 'No wallet configured' }
  }

  // Check whitelist
  const isWhitelisted = ctx.whitelist?.some(w => w.toLowerCase() === args.to.toLowerCase())
  if (!isWhitelisted) {
    return {
      success: false,
      error: `Address ${args.to} is not whitelisted`,
      whitelist: ctx.whitelist
    }
  }

  try {
    const walletContract = new ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet)

    // Verify ownership
    const owner = await walletContract.owner()
    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
      return {
        success: false,
        error: `Runtime wallet ${signerWallet.address} is not the owner of ${ctx.walletAddress}`,
        owner
      }
    }

    const valueWei = ethers.parseEther(args.amount)
    const data = args.data || '0x'

    console.log(`[tx] Executing: send ${args.amount} ETH to ${args.to}`)

    const tx = await walletContract.execute(args.to, valueWei, data)
    console.log(`[tx] Sent: ${tx.hash}`)

    const receipt = await tx.wait()

    return {
      success: true,
      txHash: tx.hash,
      to: args.to,
      amount: args.amount,
      from: ctx.walletAddress,
      blockNumber: receipt.blockNumber,
      message: `Successfully sent ${args.amount} ETH to ${args.to}`
    }
  } catch (error: any) {
    console.error('[tx] Error:', error)
    return { success: false, error: error.message || 'Transaction failed' }
  }
}

async function executeBatchTransactionsDirect(
  ctx: AgentContext,
  args: { recipients: Array<{ address: string; amount: string }> },
  agentId: string,
  orgId: number
): Promise<any> {
  if (!signerWallet || !provider) {
    return { success: false, error: 'Blockchain not configured' }
  }

  if (!ctx.walletAddress) {
    return { success: false, error: 'No wallet configured' }
  }

  const targets: string[] = []
  const values: bigint[] = []
  const dataArray: string[] = []

  let totalEth = 0

  for (const recipient of args.recipients) {
    // Check whitelist
    const isWhitelisted = ctx.whitelist?.some(w => w.toLowerCase() === recipient.address.toLowerCase())
    if (!isWhitelisted) {
      return {
        success: false,
        error: `Address ${recipient.address} is not whitelisted`,
        whitelist: ctx.whitelist
      }
    }

    targets.push(recipient.address)
    const valueWei = ethers.parseEther(recipient.amount)
    values.push(valueWei)
    dataArray.push('0x')
    totalEth += parseFloat(recipient.amount)
  }

  try {
    const walletContract = new ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet)

    const owner = await walletContract.owner()
    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
      return { success: false, error: 'Not wallet owner' }
    }

    console.log(`[tx] Batch executing: ${targets.length} transactions, total ${totalEth} ETH`)

    const tx = await walletContract.executeBatch(targets, values, dataArray)
    console.log(`[tx] Sent: ${tx.hash}`)

    const receipt = await tx.wait()

    return {
      success: true,
      txHash: tx.hash,
      recipients: args.recipients,
      totalAmount: totalEth.toString(),
      from: ctx.walletAddress,
      blockNumber: receipt.blockNumber,
      message: `Successfully sent ${totalEth} ETH to ${targets.length} addresses`
    }
  } catch (error: any) {
    console.error('[tx] Batch error:', error)
    return { success: false, error: error.message || 'Batch transaction failed' }
  }
}

async function executeDepositGasDirect(
  ctx: AgentContext,
  args: { amount: string },
  agentId: string,
  orgId: number
): Promise<any> {
  if (!signerWallet || !provider) {
    return { success: false, error: 'Blockchain not configured' }
  }

  if (!ctx.walletAddress) {
    return { success: false, error: 'No wallet configured' }
  }

  try {
    const walletContract = new ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet)

    const owner = await walletContract.owner()
    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
      return { success: false, error: 'Not wallet owner' }
    }

    const amountWei = ethers.parseEther(args.amount)

    console.log(`[tx] Depositing ${args.amount} ETH to EntryPoint`)

    const tx = await walletContract.addDeposit({ value: amountWei })
    console.log(`[tx] Sent: ${tx.hash}`)

    const receipt = await tx.wait()

    // Get new deposit balance
    const newDeposit = await walletContract.getDeposit()

    return {
      success: true,
      txHash: tx.hash,
      amount: args.amount,
      newDepositBalance: ethers.formatEther(newDeposit),
      message: `Deposited ${args.amount} ETH to EntryPoint. New balance: ${ethers.formatEther(newDeposit)} ETH`
    }
  } catch (error: any) {
    console.error('[tx] Deposit error:', error)
    return { success: false, error: error.message || 'Deposit failed' }
  }
}

async function executeWithdrawGasDirect(
  ctx: AgentContext,
  args: { recipient: string; amount: string },
  agentId: string,
  orgId: number
): Promise<any> {
  if (!signerWallet || !provider) {
    return { success: false, error: 'Blockchain not configured' }
  }

  if (!ctx.walletAddress) {
    return { success: false, error: 'No wallet configured' }
  }

  try {
    const walletContract = new ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet)

    const owner = await walletContract.owner()
    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
      return { success: false, error: 'Not wallet owner' }
    }

    const amountWei = ethers.parseEther(args.amount)

    console.log(`[tx] Withdrawing ${args.amount} ETH from EntryPoint to ${args.recipient}`)

    const tx = await walletContract.withdrawDepositTo(args.recipient, amountWei)
    console.log(`[tx] Sent: ${tx.hash}`)

    const receipt = await tx.wait()

    return {
      success: true,
      txHash: tx.hash,
      amount: args.amount,
      recipient: args.recipient,
      message: `Withdrew ${args.amount} ETH from EntryPoint to ${args.recipient}`
    }
  } catch (error: any) {
    console.error('[tx] Withdraw error:', error)
    return { success: false, error: error.message || 'Withdrawal failed' }
  }
}

async function executeAddWhitelistDirect(
  ctx: AgentContext,
  args: { address: string },
  agentId: string,
  orgId: number
): Promise<any> {
  if (!signerWallet || !provider) {
    return { success: false, error: 'Blockchain not configured' }
  }

  if (!ctx.walletAddress) {
    return { success: false, error: 'No wallet configured' }
  }

  try {
    const walletContract = new ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet)

    const owner = await walletContract.owner()
    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
      return { success: false, error: 'Not wallet owner' }
    }

    console.log(`[tx] Adding ${args.address} to whitelist`)

    const tx = await walletContract.setWhiteListedParty(args.address, true)
    console.log(`[tx] Sent: ${tx.hash}`)

    const receipt = await tx.wait()

    // Update context
    ctx.whitelist = [...(ctx.whitelist || []), args.address]

    return {
      success: true,
      txHash: tx.hash,
      address: args.address,
      message: `Added ${args.address} to whitelist`
    }
  } catch (error: any) {
    console.error('[tx] Whitelist add error:', error)
    return { success: false, error: error.message || 'Failed to add to whitelist' }
  }
}

async function executeRemoveWhitelistDirect(
  ctx: AgentContext,
  args: { address: string },
  agentId: string,
  orgId: number
): Promise<any> {
  if (!signerWallet || !provider) {
    return { success: false, error: 'Blockchain not configured' }
  }

  if (!ctx.walletAddress) {
    return { success: false, error: 'No wallet configured' }
  }

  try {
    const walletContract = new ethers.Contract(ctx.walletAddress, AGENT_WALLET_ABI, signerWallet)

    const owner = await walletContract.owner()
    if (owner.toLowerCase() !== signerWallet.address.toLowerCase()) {
      return { success: false, error: 'Not wallet owner' }
    }

    console.log(`[tx] Removing ${args.address} from whitelist`)

    const tx = await walletContract.setWhiteListedParty(args.address, false)
    console.log(`[tx] Sent: ${tx.hash}`)

    const receipt = await tx.wait()

    // Update context
    ctx.whitelist = ctx.whitelist?.filter(w => w.toLowerCase() !== args.address.toLowerCase()) || []

    return {
      success: true,
      txHash: tx.hash,
      address: args.address,
      message: `Removed ${args.address} from whitelist`
    }
  } catch (error: any) {
    console.error('[tx] Whitelist remove error:', error)
    return { success: false, error: error.message || 'Failed to remove from whitelist' }
  }
}

async function executeGetBalanceDirect(
  ctx: AgentContext,
  agentId: string,
  orgId: number
): Promise<any> {
  if (!ctx.walletAddress) {
    return { success: false, error: 'No wallet configured' }
  }

  const balances = await getOnChainBalances(ctx.walletAddress)

  return {
    success: true,
    walletAddress: ctx.walletAddress,
    balance: balances.balance,
    depositBalance: balances.deposit,
    whitelist: ctx.whitelist,
    whitelistCount: ctx.whitelist?.length || 0
  }
}

async function executeCheckWhitelistDirect(
  ctx: AgentContext,
  args: { address: string },
  agentId: string,
  orgId: number
): Promise<any> {
  if (!ctx.walletAddress) {
    return { success: false, error: 'No wallet configured' }
  }

  const isWhitelisted = ctx.whitelist?.some(w => w.toLowerCase() === args.address.toLowerCase()) || false

  return {
    success: true,
    address: args.address,
    isWhitelisted,
    walletAddress: ctx.walletAddress
  }
}

// ============================================================
// HTTP ENDPOINT WRAPPERS (for direct calls)
// ============================================================

async function executeSendTransaction(req: any, res: any, params: any, agentId: string, orgId: number) {
  const ctx = await fetchAgentContext(agentId, orgId)
  const result = await executeSendTransactionDirect(ctx, params, agentId, orgId)
  return res.json({ ...result, type: 'transaction' })
}

async function executeBatchTransactions(req: any, res: any, params: any, agentId: string, orgId: number) {
  const ctx = await fetchAgentContext(agentId, orgId)
  const result = await executeBatchTransactionsDirect(ctx, params, agentId, orgId)
  return res.json({ ...result, type: 'batch_transaction' })
}

async function executeDepositGas(req: any, res: any, params: any, agentId: string, orgId: number) {
  const ctx = await fetchAgentContext(agentId, orgId)
  const result = await executeDepositGasDirect(ctx, params, agentId, orgId)
  return res.json({ ...result, type: 'deposit' })
}

async function executeWithdrawGas(req: any, res: any, params: any, agentId: string, orgId: number) {
  const ctx = await fetchAgentContext(agentId, orgId)
  const result = await executeWithdrawGasDirect(ctx, params, agentId, orgId)
  return res.json({ ...result, type: 'withdrawal' })
}

async function executeAddWhitelist(req: any, res: any, params: any, agentId: string, orgId: number) {
  const ctx = await fetchAgentContext(agentId, orgId)
  const result = await executeAddWhitelistDirect(ctx, params, agentId, orgId)
  return res.json({ ...result, type: 'whitelist_add' })
}

async function executeRemoveWhitelist(req: any, res: any, params: any, agentId: string, orgId: number) {
  const ctx = await fetchAgentContext(agentId, orgId)
  const result = await executeRemoveWhitelistDirect(ctx, params, agentId, orgId)
  return res.json({ ...result, type: 'whitelist_remove' })
}

async function executeGetBalance(req: any, res: any, agentId: string, orgId: number) {
  const ctx = await fetchAgentContext(agentId, orgId)
  const result = await executeGetBalanceDirect(ctx, agentId, orgId)
  return res.json(result)
}

async function executeCheckWhitelist(req: any, res: any, params: any, agentId: string, orgId: number) {
  const ctx = await fetchAgentContext(agentId, orgId)
  const result = await executeCheckWhitelistDirect(ctx, params, agentId, orgId)
  return res.json(result)
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt(ctx: AgentContext): string {
  let prompt = `You are an AI agent operating under the Agentix Protocol. You have access to a blockchain wallet and can execute transactions ONLY to whitelisted addresses.

## Your Wallet Tools

You have these tools available:

### Transactions
- **send_transaction**: Send ETH to a single whitelisted address
- **batch_transactions**: Send ETH to multiple whitelisted addresses at once

### Gas Management
- **deposit_gas**: Add ETH to the EntryPoint for transaction gas
- **withdraw_gas**: Withdraw ETH from EntryPoint deposit

### Whitelist Management
- **add_to_whitelist**: Allow an address to receive transactions
- **remove_from_whitelist**: Remove address from allowed list

### Information
- **get_wallet_balance**: Check wallet and deposit balances
- **check_whitelist**: Verify if an address is whitelisted

## Rules

1. ALWAYS verify the recipient is whitelisted before sending
2. Ask for confirmation before executing transactions
3. Explain what you're about to do clearly
4. If recipient is not whitelisted, offer to add them

## Current Context

### Wallet
- Address: ${ctx.walletAddress || 'Not configured'}
- Owner: ${ctx.ownerAddress || 'Unknown'}
- Balance: ${ctx.balance || '0'} ETH
- Gas Deposit: ${ctx.depositBalance || '0'} ETH

### Whitelist (${ctx.whitelist?.length || 0} addresses)
${ctx.whitelist && ctx.whitelist.length > 0
  ? ctx.whitelist.slice(0, 10).map(w => `- ${w}`).join('\n') + (ctx.whitelist.length > 10 ? `\n... and ${ctx.whitelist.length - 10} more` : '')
  : '- No addresses whitelisted'
}
`

  return prompt
}

// ============================================================
// START SERVER
// ============================================================

app.listen(RUNTIME_PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Agentix Runtime Server (with Function Calling)              ║
╠══════════════════════════════════════════════════════════════╣
║  Port: ${RUNTIME_PORT}                                                 ║
║  Runtime ID: ${RUNTIME_ID}                                  ║
║  Blockchain: ${signerWallet ? '✓ Connected' : '✗ Not configured'}                                ║
║  Signer: ${signerWallet ? signerWallet.address.slice(0, 20) + '...' : 'N/A'}                              ║
║  OpenAI: ${OPENAI_API_KEY ? '✓ Configured' : '✗ Not configured'}                                    ║
║  Model: ${OPENAI_MODEL}                                        ║
╠══════════════════════════════════════════════════════════════╣
║  Available Functions:                                        ║
║  - send_transaction    (single transfer)                     ║
║  - batch_transactions  (multiple transfers)                  ║
║  - deposit_gas         (fund EntryPoint)                     ║
║  - withdraw_gas        (withdraw from EntryPoint)            ║
║  - add_to_whitelist    (allow address)                       ║
║  - remove_from_whitelist (block address)                     ║
║  - get_wallet_balance  (check balance)                       ║
║  - check_whitelist     (verify address)                      ║
╚══════════════════════════════════════════════════════════════╝
`)
})
