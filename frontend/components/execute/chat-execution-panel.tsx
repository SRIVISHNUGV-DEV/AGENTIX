"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Wifi,
  WifiOff,
  Trash2,
  ScrollText,
  ChevronDown,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { ChatMessageComponent } from "./chat-message"
import { ChatInput } from "./chat-input"
import { QuickActions, type QuickAction } from "./quick-actions"
import {
  type ChatMessage,
  loadChatHistory,
  saveChatHistory,
  clearChatHistory,
} from "@/lib/chat-storage"
import { executeChatMessage, type ChatMessageResult, getAgentProvisioningStatus, type AgentProvisioningStatus } from "@/lib/external-agents-api"
import type { SignaturePayload } from "@/lib/external-agents-api"

interface ChatExecutionPanelProps {
  agentId: string
  externalAgentId: number
  agentName: string
  orgId: number
  isConnected?: boolean
  signature?: SignaturePayload
}

/**
 * Chat Execution Panel
 *
 * Sends messages to the agent runtime via backend.
 * Backend routes to correct runtime endpoint (local, Lambda, Cloudflare, etc.)
 *
 * Protocol Actions (from AgentWallet.sol):
 * - execute() → Send Transaction
 * - executeBatch() → Batch Transactions
 * - addToWhitelist() / removeFromWhitelist() → via chat
 * - depositToEntryPoint() → Deposit Gas
 */
export function ChatExecutionPanel({
  agentId,
  externalAgentId,
  agentName,
  orgId,
  isConnected = true,
  signature,
}: ChatExecutionPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedAction, setSelectedAction] = useState<QuickAction | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [provisioningStatus, setProvisioningStatus] = useState<AgentProvisioningStatus | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

  // Load chat history on mount
  useEffect(() => {
    const history = loadChatHistory(agentId)
    setMessages(history)
  }, [agentId])

  // Check provisioning status on mount
  useEffect(() => {
    if (!externalAgentId) return

    getAgentProvisioningStatus(externalAgentId).then((status) => {
      setProvisioningStatus(status)

      if (!status.isReady && messages.length === 0) {
        const welcomeMessage: ChatMessage = {
          id: generateId(),
          role: "agent",
          content: `Welcome! I'm your autonomous agent. To start transacting, I need to set up a wallet and session for you.\n\nPlease tell me:\n1. Your wallet address (to set as owner)\n2. How much ETH to fund the wallet (default: 0.05 ETH)\n3. How much ETH for gas (default: 0.01 ETH)\n\nExample: "My address is 0x..., fund 0.1 ETH, gas 0.02 ETH"`,
          timestamp: Date.now(),
          status: "complete",
        }
        setMessages([welcomeMessage])
      }
    })
  }, [externalAgentId])

  // Save chat history when messages change
  useEffect(() => {
    if (messages.length > 0) {
      saveChatHistory(agentId, messages)
    }
  }, [agentId, messages])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Track scroll position
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 200
    setShowScrollButton(!isNearBottom)
  }, [])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const handleSendMessage = async (content: string, action?: QuickAction) => {
    if (!content.trim() || !externalAgentId) return

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content,
      timestamp: Date.now(),
      status: "sent",
    }

    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    // Add placeholder agent message for streaming
    const agentMessageId = generateId()
    const agentMessage: ChatMessage = {
      id: agentMessageId,
      role: "agent",
      content: "",
      timestamp: Date.now(),
      status: "streaming",
      isStreaming: true,
    }

    setMessages((prev) => [...prev, agentMessage])

    try {
      // Execute chat message via backend → runtime
      const result: ChatMessageResult = await executeChatMessage(
        externalAgentId,
        content,
        orgId,
        signature
      )

      // Build response content
      let responseContent = ""
      let executionData: ChatMessage["execution"] = undefined

      if (result.success) {
        responseContent = result.response || "Action completed successfully"

        if (result.result) {
          executionData = {
            action: action?.id || "chat",
            params: { message: content },
            result: result.result,
            success: true,
          }

          // Add transaction details if available
          if (result.result.type === "transaction" && result.result.txHash) {
            responseContent += `\n\nTransaction: ${result.result.txHash}`
          }
          if (result.result.amount) {
            responseContent += `\nAmount: ${result.result.amount} ETH`
          }
          if (result.result.address) {
            responseContent += `\nTo: ${result.result.address}`
          }
        }
      } else {
        responseContent = `Error: ${result.error || "Action failed"}`
        executionData = {
          action: action?.id || "chat",
          params: { message: content },
          success: false,
          error: result.error,
        }
      }

      // Update agent message with result
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === agentMessageId
            ? {
                ...msg,
                content: responseContent,
                status: result.success ? "complete" : "error",
                isStreaming: false,
                execution: executionData,
              }
            : msg
        )
      )
    } catch (error) {
      // Update agent message with error
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === agentMessageId
            ? {
                ...msg,
                content: `Failed: ${errorMessage}`,
                status: "error",
                isStreaming: false,
                execution: {
                  action: action?.id || "chat",
                  params: { message: content },
                  success: false,
                  error: errorMessage,
                },
              }
            : msg
        )
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleActionSelect = (action: QuickAction) => {
    setSelectedAction(action)
  }

  const handleRerun = async (message: ChatMessage) => {
    if (!message.execution) return

    // Find the corresponding user message
    const messageIndex = messages.findIndex((m) => m.id === message.id)
    const userMessage = messages[messageIndex - 1]

    if (userMessage) {
      await handleSendMessage(userMessage.content, {
        id: message.execution.action,
        label: message.execution.action.replace("_", " "),
        icon: null,
        template: "",
        description: "",
      })
    }
  }

  const handleClearHistory = () => {
    if (window.confirm("Clear all chat history for this agent?")) {
      clearChatHistory(agentId)
      setMessages([])
    }
  }

  return (
    <div className="flex flex-col h-full bg-black rounded-xl overflow-hidden border border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white font-mono">Execute</h2>
          <span className="text-sm text-zinc-500">—</span>
          <span className="text-sm font-medium text-zinc-300">{agentName}</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            {isConnected ? (
              <>
                <Wifi className="h-4 w-4 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-500">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-red-500" />
                <span className="text-xs font-medium text-red-500">Disconnected</span>
              </>
            )}
          </div>

          {/* Clear History */}
          <button
            onClick={handleClearHistory}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors group"
            title="Clear chat history"
          >
            <Trash2 className="h-3.5 w-3.5 text-zinc-400 group-hover:text-zinc-200 transition-colors" />
            <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">Clear</span>
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-2 scroll-smooth"
        style={{
          background: "radial-gradient(ellipse at top, rgba(39, 39, 42, 0.5) 0%, black 60%)",
        }}
      >
        {/* Empty State */}
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full text-center py-16"
          >
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
              <ScrollText className="h-8 w-8 text-zinc-600" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-300 mb-2">Start a conversation</h3>
            <p className="text-sm text-zinc-500 max-w-xs">
              Send transactions, deposit gas, manage whitelist, or chat with your agent.
            </p>

            {/* Available Actions */}
            <div className="flex flex-wrap gap-2 mt-6 justify-center">
              <span className="px-2 py-1 text-xs bg-zinc-800 text-zinc-400 rounded">Send Transaction</span>
              <span className="px-2 py-1 text-xs bg-zinc-800 text-zinc-400 rounded">Batch Transactions</span>
              <span className="px-2 py-1 text-xs bg-zinc-800 text-zinc-400 rounded">Deposit Gas</span>
              <span className="px-2 py-1 text-xs bg-zinc-800 text-zinc-400 rounded">Whitelist Address</span>
            </div>
          </motion.div>
        )}

        {/* Messages */}
        <AnimatePresence mode="popLayout">
          {messages.map((message) => (
            <ChatMessageComponent
              key={message.id}
              message={message}
              onRerun={message.execution ? handleRerun : undefined}
            />
          ))}
        </AnimatePresence>

        {/* Loading Indicator */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-4 py-2 text-zinc-500"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Processing...</span>
          </motion.div>
        )}

        {/* Scroll Anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to Bottom Button */}
      <AnimatePresence>
        {showScrollButton && messages.length > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={scrollToBottom}
            className="absolute bottom-32 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-full text-xs font-medium text-zinc-300 shadow-lg transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            Scroll to latest
          </motion.button>
        )}
      </AnimatePresence>

      {/* Quick Actions Bar */}
      <QuickActions onActionSelect={handleActionSelect} />

      {/* Input Area */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
        <ChatInput
          onSend={handleSendMessage}
          isLoading={isLoading}
          disabled={!isConnected}
          action={selectedAction}
          onClearAction={() => setSelectedAction(null)}
          initialValue={selectedAction?.template || ""}
        />
      </div>

      {/* Warning Banner if Disconnected */}
      <AnimatePresence>
        {!isConnected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border-t border-red-500/20">
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-400">
                Agent runtime is not connected. Connect the runtime to execute actions.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
