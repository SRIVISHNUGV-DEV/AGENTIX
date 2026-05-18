"use client"

import { useState, useRef, useEffect } from "react"
import {
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Play,
  Terminal,
  User,
  Bot,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import type { ChatMessage } from "@/lib/chat-storage"
import { formatChatTimestamp } from "@/lib/chat-storage"

interface ChatMessageProps {
  message: ChatMessage
  onRerun?: (message: ChatMessage) => void
}

export function ChatMessageComponent({ message, onRerun }: ChatMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const isUser = message.role === "user"
  const hasExecution = !!message.execution
  const isSuccess = message.execution?.success !== false

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  const getStatusIcon = () => {
    switch (message.status) {
      case "sending":
        return <Clock className="h-3.5 w-3.5 text-zinc-500 animate-pulse" />
      case "streaming":
        return <Loader2 className="h-3.5 w-3.5 text-zinc-400 animate-spin" />
      case "complete":
      case "sent":
        return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
      case "error":
        return <XCircle className="h-3.5 w-3.5 text-red-500" />
      default:
        return null
    }
  }

  const getActionIcon = (action: string) => {
    const iconClass = "h-4 w-4"
    switch (action) {
      case "execute_command":
        return <Terminal className={iconClass} />
      case "read_file":
        return <Play className={iconClass} />
      case "api_call":
        return <Play className={iconClass} />
      default:
        return <Play className={iconClass} />
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
    >
      <div
        className={`max-w-[85%] ${isUser ? "order-2" : "order-1"}`}
      >
        {/* Avatar + Timestamp Header */}
        <div className={`flex items-center gap-2 mb-2 ${isUser ? "justify-end" : "justify-start"}`}>
          {!isUser && (
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-zinc-900 border border-zinc-800">
              <Bot className="h-3.5 w-3.5 text-zinc-300" />
            </div>
          )}
          <span className="text-[11px] font-mono text-zinc-600 tabular-nums">
            {formatChatTimestamp(message.timestamp)}
          </span>
          {getStatusIcon()}
          {isUser && (
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-zinc-200">
              <User className="h-3.5 w-3.5 text-zinc-700" />
            </div>
          )}
        </div>

        {/* Message Bubble */}
        <div
          className={`
            relative rounded-2xl border transition-colors duration-200
            ${isUser
              ? "bg-zinc-100 border-zinc-200 text-zinc-900"
              : hasExecution
                ? isSuccess
                  ? "bg-emerald-50/50 border-emerald-200/50 text-zinc-900"
                  : "bg-red-50/50 border-red-200/50 text-zinc-900"
                : "bg-zinc-900 border-zinc-800 text-zinc-100"
            }
          `}
        >
          {/* Content */}
          <div className="px-4 py-3">
            {isUser ? (
              <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap break-words">
                {message.content}
              </p>
            ) : hasExecution ? (
              <div className="space-y-3">
                {/* Execution Header */}
                <div className="flex items-center gap-3">
                  <div className={`
                    flex items-center justify-center w-8 h-8 rounded-lg
                    ${isSuccess ? "bg-emerald-100" : "bg-red-100"}
                  `}>
                    {isSuccess ? (
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium uppercase tracking-wide">
                        {message.execution?.action?.replace("_", " ")}
                      </span>
                      {message.execution?.executionTimeMs && (
                        <span className="text-xs font-mono text-zinc-500 tabular-nums">
                          {message.execution.executionTimeMs}ms
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-600">{message.content}</p>
                  </div>
                </div>

                {/* Expandable Details */}
                <AnimatePresence>
                  {isExpanded ? (
                    <motion.div
                      key="details"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      {/* Parameters */}
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Parameters
                          </span>
                        </div>
                        <pre className="text-xs font-mono bg-zinc-900/5 rounded-lg p-3 overflow-x-auto border border-zinc-200/50">
                          {JSON.stringify(message.execution?.params ?? {}, null, 2)}
                        </pre>
                      </div>

                      {/* Result */}
                      {message.execution?.result !== undefined && message.execution?.result !== null && (
                        <div className="mb-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                              Result
                            </span>
                            <button
                              onClick={() => copyToClipboard(JSON.stringify(message.execution?.result, null, 2))}
                              className="flex items-center gap-1 text-[10px] font-medium text-zinc-500 hover:text-zinc-700 transition-colors"
                            >
                              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                              {copied ? "Copied" : "Copy"}
                            </button>
                          </div>
                          <pre className="text-xs font-mono bg-zinc-900 text-zinc-100 rounded-lg p-3 overflow-x-auto max-h-48">
                            {JSON.stringify(message.execution?.result ?? null, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Error */}
                      {message.execution?.error && (
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1.5 block">
                            Error
                          </span>
                          <pre className="text-xs font-mono bg-red-100 text-red-700 rounded-lg p-3 overflow-x-auto border border-red-200">
                            {message.execution.error}
                          </pre>
                        </div>
                      )}
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-zinc-200/50">
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 transition-colors"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" />
                        Hide Details
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        View Details
                      </>
                    )}
                  </button>
                  {onRerun && (
                    <button
                      onClick={() => onRerun(message)}
                      className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 transition-colors ml-auto"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Re-run
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                {message.content}
              </p>
            )}
          </div>

          {/* Streaming Animation */}
          {message.isStreaming && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-200 overflow-hidden rounded-b-2xl">
              <motion.div
                className="h-full bg-zinc-500"
                animate={{
                  x: ["-100%", "100%"],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
