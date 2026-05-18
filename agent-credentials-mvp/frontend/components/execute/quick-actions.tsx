"use client"

import {
  Send,
  Layers,
  MessageSquare,
  Wallet,
} from "lucide-react"
import { motion } from "framer-motion"

export interface QuickAction {
  id: string
  label: string
  icon: React.ReactNode
  template: string
  description: string
}

interface QuickActionsProps {
  onActionSelect: (action: QuickAction) => void
}

/**
 * Quick actions for agent execution
 * Only includes actions the AgentWallet protocol supports:
 * - execute() → Send Transaction
 * - executeBatch() → Batch Transactions
 * - Custom chat for whitelist, deposit, withdraw operations
 */
const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "send_transaction",
    label: "Send Transaction",
    icon: <Send className="h-4 w-4" />,
    template: "Send 0.1 ETH to ",
    description: "Send ETH to a whitelisted address",
  },
  {
    id: "batch_transactions",
    label: "Batch Transactions",
    icon: <Layers className="h-4 w-4" />,
    template: "Send 0.05 ETH each to: ",
    description: "Send ETH to multiple whitelisted addresses",
  },
  {
    id: "deposit_gas",
    label: "Deposit Gas",
    icon: <Wallet className="h-4 w-4" />,
    template: "Deposit 0.1 ETH to the EntryPoint for gas",
    description: "Fund the agent wallet for transaction gas",
  },
  {
    id: "custom",
    label: "Custom",
    icon: <MessageSquare className="h-4 w-4" />,
    template: "",
    description: "Free-form request (whitelist, withdraw, etc.)",
  },
]

export function QuickActions({ onActionSelect }: QuickActionsProps) {
  return (
    <div className="border-t border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_ACTIONS.map((action, index) => (
          <motion.button
            key={action.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            onClick={() => onActionSelect(action)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600 transition-all duration-200 group"
            title={action.description}
          >
            <span className="text-zinc-400 group-hover:text-zinc-200 transition-colors">
              {action.icon}
            </span>
            <span className="text-xs font-medium text-zinc-300 group-hover:text-white transition-colors">
              {action.label}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
