"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Send, Loader2, Square } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import type { QuickAction } from "./quick-actions"

interface ChatInputProps {
  onSend: (message: string, action?: QuickAction) => void
  isLoading?: boolean
  disabled?: boolean
  placeholder?: string
  initialValue?: string
  action?: QuickAction | null
  onClearAction?: () => void
}

export function ChatInput({
  onSend,
  isLoading = false,
  disabled = false,
  placeholder = "Type a message or command...",
  initialValue = "",
  action,
  onClearAction,
}: ChatInputProps) {
  const [message, setMessage] = useState(initialValue)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync message with initialValue when action changes
  useEffect(() => {
    if (initialValue) {
      setMessage(initialValue)
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(initialValue.length, initialValue.length)
      }, 10)
    }
  }, [initialValue])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`
    }
  }, [message])

  const handleSend = useCallback(() => {
    const trimmed = message.trim()
    if (!trimmed || isLoading || disabled) return

    onSend(trimmed, action || undefined)
    setMessage("")
    onClearAction?.()
  }, [message, isLoading, disabled, onSend, action, onClearAction])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to send
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSend()
      return
    }

    // Enter to send (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCancel = () => {
    setMessage("")
    onClearAction?.()
  }

  return (
    <div className="relative w-full">
      {/* Selected Action Badge */}
      <AnimatePresence>
        {action && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 mb-2"
          >
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-xs font-medium text-zinc-300">
              <span className="text-zinc-400">{action.icon}</span>
              {action.label}
            </span>
            <button
              onClick={onClearAction}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Container */}
      <div
        className={`
          relative flex items-end gap-2 rounded-2xl border bg-zinc-900 transition-all duration-200
          ${isFocused
            ? "border-zinc-600 ring-2 ring-zinc-700/50"
            : "border-zinc-800"}
          ${disabled && "opacity-50 cursor-not-allowed"}
        `}
      >
        {/* Input Area */}
        <div className="flex-1 relative flex items-center pl-4 pr-2 py-3">
          <span className="text-zinc-500 text-sm mr-2 select-none">&gt;</span>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={action ? `${action.template}` : placeholder}
            rows={1}
            className="w-full bg-transparent text-sm text-white placeholder-zinc-500 resize-none outline-none font-mono leading-relaxed"
            style={{ maxHeight: "128px" }}
          />
        </div>

        {/* Send/Cancel Button */}
        <div className="flex items-center gap-1 pr-2 pb-2">
          {isLoading ? (
            <button
              onClick={handleCancel}
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-colors border border-zinc-700"
              title="Cancel"
            >
              <Square className="h-4 w-4 text-zinc-400 fill-current" />
            </button>
          ) : (
            <motion.button
              initial={false}
              animate={{
                scale: message.trim() ? 1 : 0.95,
                opacity: message.trim() ? 1 : 0.5,
              }}
              onClick={handleSend}
              disabled={!message.trim() || disabled}
              className={`
                flex items-center justify-center w-9 h-9 rounded-xl transition-colors
                ${message.trim()
                  ? "bg-white hover:bg-zinc-200 cursor-pointer"
                  : "bg-zinc-800 cursor-not-allowed"
                }
              `}
              title="Send message (Cmd+Enter)"
            >
              <Send className="h-4 w-4 text-zinc-900" />
            </motion.button>
          )}
        </div>
      </div>

      {/* Keyboard Hint */}
      <div className="flex items-center justify-between mt-2 px-1">
        <p className="text-[10px] text-zinc-600 font-mono">
          Press <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">Enter</kbd> to send · <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">Shift+Enter</kbd> for new line
        </p>
        {message.length > 0 && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[10px] text-zinc-600 tabular-nums"
          >
            {message.length} chars
          </motion.span>
        )}
      </div>
    </div>
  )
}
