"use client"

import { Execution } from "./types"

export interface ChatMessage {
  id: string
  role: "user" | "agent"
  content: string
  timestamp: number
  status?: "sending" | "sent" | "streaming" | "complete" | "error"
  execution?: {
    action: string
    params: Record<string, unknown>
    result?: unknown
    executionTimeMs?: number
    success?: boolean
    error?: string
    txHash?: string
  }
  isStreaming?: boolean
}

const STORAGE_KEY_PREFIX = "agentix_chat_"
const MAX_MESSAGES = 100

export function getChatStorageKey(agentId: string): string {
  return `${STORAGE_KEY_PREFIX}${agentId}`
}

export function loadChatHistory(agentId: string): ChatMessage[] {
  if (typeof window === "undefined") return []

  try {
    const stored = localStorage.getItem(getChatStorageKey(agentId))
    if (!stored) return []

    const messages = JSON.parse(stored) as ChatMessage[]
    // Filter out messages older than 24 hours
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    return messages.filter(m => m.timestamp > dayAgo)
  } catch {
    return []
  }
}

export function saveChatHistory(agentId: string, messages: ChatMessage[]): void {
  if (typeof window === "undefined") return

  try {
    // Keep only the most recent messages
    const trimmed = messages.slice(-MAX_MESSAGES)
    localStorage.setItem(getChatStorageKey(agentId), JSON.stringify(trimmed))
  } catch (error) {
    console.error("Failed to save chat history:", error)
  }
}

export function clearChatHistory(agentId: string): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(getChatStorageKey(agentId))
}

export function formatChatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

export function executionToMessage(exec: Execution): ChatMessage {
  return {
    id: exec.id,
    role: "agent",
    content: exec.success
      ? `Executed ${exec.action} successfully`
      : `Execution failed: ${exec.errorMessage || "Unknown error"}`,
    timestamp: new Date(exec.createdAt).getTime(),
    status: exec.success ? "complete" : "error",
    execution: {
      action: exec.action,
      params: exec.params,
      result: exec.result,
      executionTimeMs: exec.executionTimeMs,
      success: exec.success,
      error: exec.errorMessage || undefined,
    },
  }
}
