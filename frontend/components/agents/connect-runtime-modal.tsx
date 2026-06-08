"use client"

import Image from "next/image"
import { useState, useEffect } from "react"
import { Loader2, Link2, Cpu, Bot, ShieldCheck, Wallet, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useWallet } from "@/components/wallet/wallet-provider"
import {
  createExternalAgent,
  connectExternalAgentToProtocolAgent,
  listAgentTypes,
  type AgentTypeInfo,
} from "@/lib/external-agents-api"

type ProviderVisual = {
  logo: string
  eyebrow: string
  summary: string
}

const providerVisuals: Record<string, ProviderVisual> = {
  openclaude: {
    logo: '/provider-logos/anthropic.png',
    eyebrow: 'Terminal-native execution',
    summary: 'Good for code, filesystem, and direct operator loop automation.',
  },
  langchain: {
    logo: '/provider-logos/langchain.png',
    eyebrow: 'Framework orchestration',
    summary: 'Good for tool chains, memory, retrieval, and multi-step reasoning.',
  },
  claude_code: {
    logo: '/provider-logos/claudecode.png',
    eyebrow: 'Claude-powered coding',
    summary: 'Claude Code CLI integration for autonomous coding and terminal operations.',
  },
  crewai: {
    logo: '/provider-logos/crewai.png',
    eyebrow: 'Multi-agent orchestration',
    summary: 'Orchestrate multiple AI agents working together as a crew.',
  },
  llama_index: {
    logo: '/provider-logos/llamaindex.png',
    eyebrow: 'Data framework for LLMs',
    summary: 'Connect your data to LLMs with retrieval-augmented generation.',
  },
  autogen: {
    logo: '/provider-logos/autogen.png',
    eyebrow: 'Multi-agent conversation',
    summary: 'Microsoft framework for building conversational AI agents.',
  },
  smolagents: {
    logo: '/provider-logos/smolagents.png',
    eyebrow: 'Lightweight agents',
    summary: 'Minimalist agent framework for simple but powerful AI workflows.',
  },
  custom: {
    logo: '/provider-logos/custom.svg',
    eyebrow: 'Custom runtime',
    summary: 'Use your own runtime when the provider does not fit the preset fleet shapes.',
  },
}

function isValidUrl(url: string): boolean {
  if (!url.trim()) return true // Empty is valid
  try {
    new URL(url)
    return true
  } catch {
    return /^[a-zA-Z0-9\-\.]+(:[0-9]{1,5})?$/.test(url) ||
           /^https?:\/\/.+$/.test(url)
  }
}

interface ConnectRuntimeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  protocolAgentId: number
  orgId: number
  agentName: string
  onConnected: () => void
}

export function ConnectRuntimeModal({
  open,
  onOpenChange,
  protocolAgentId,
  orgId,
  agentName,
  onConnected,
}: ConnectRuntimeModalProps) {
  const { account, isConnected, isBaseSepolia, signPlatformAction } = useWallet()

  const [agentTypes, setAgentTypes] = useState<AgentTypeInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedType, setSelectedType] = useState<AgentTypeInfo | null>(null)
  const [runtimeName, setRuntimeName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // Load agent types when modal opens
  useEffect(() => {
    if (open) {
      setLoading(true)
      listAgentTypes()
        .then(setAgentTypes)
        .catch((e) => setError(e.message ?? 'Failed to load providers'))
        .finally(() => setLoading(false))
    }
  }, [open])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedType(null)
      setRuntimeName('')
      setEndpoint('')
      setError(null)
      setStatus(null)
    }
  }, [open])

  const handleConnect = async () => {
    if (!selectedType || !runtimeName.trim() || !account) return

    if (endpoint.trim() && !isValidUrl(endpoint.trim())) {
      setError('Please enter a valid endpoint URL')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      // Step 1: Validate wallet connection
      if (!isConnected) {
        throw new Error('Please connect your wallet first')
      }
      if (!isBaseSepolia) {
        throw new Error('Please switch to Base Sepolia network')
      }

      // Step 2: Create signature for linking
      // Must match what backend expects: action=CREATE_EXTERNAL_AGENT, target=org:{orgId}
      setStatus('Requesting signature...')
      const signature = await signPlatformAction({
        action: 'CREATE_EXTERNAL_AGENT',
        orgId: orgId,
        target: `org:${orgId}`,
      })

      setStatus('Connecting runtime...')

      // Step 3: Connect the external agent to this protocol agent
      // Note: wallet address comes from signature.walletAddress (fresh from wallet)
      const result = await connectExternalAgentToProtocolAgent(
        {
          protocolAgentId,
          orgId,
          runtimeType: selectedType.id,
          name: runtimeName.trim(),
        },
        signature
      )

      setStatus('Runtime connected!')

      // Close modal and refresh
      setTimeout(() => {
        onOpenChange(false)
        onConnected()
      }, 500)
    } catch (e: any) {
      setError(e.message ?? 'Failed to connect runtime')
      setStatus(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto border-zinc-700 bg-zinc-900 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-xl">Connect a Runtime</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Link an external runtime to this agent for remote execution.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-600" />
          </div>
        ) : selectedType ? (
          // Step 2: Configure the selected provider
          <div className="space-y-5 py-4">
            <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/50 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 p-1.5">
                <Image
                  src={(providerVisuals[selectedType.id] ?? providerVisuals.custom).logo}
                  alt={selectedType.name}
                  width={36}
                  height={36}
                  className="h-full w-full object-contain"
                />
              </div>
              <div>
                <div className="font-medium">{selectedType.name}</div>
                <div className="text-sm text-zinc-500">
                  {(providerVisuals[selectedType.id] ?? providerVisuals.custom).summary}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-300">Runtime Name</Label>
              <Input
                value={runtimeName}
                onChange={(e) => setRuntimeName(e.target.value)}
                placeholder="e.g., Production Runtime"
                className="border-zinc-700 bg-zinc-800"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-300">Endpoint (optional)</Label>
              <Input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://runtime.example.com"
                className="border-zinc-700 bg-zinc-800"
              />
              <p className="text-xs text-zinc-500">The URL where this runtime can be reached</p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4">
              <div className="text-xs text-zinc-500 uppercase mb-3">Linking to Agent #{protocolAgentId}</div>
              <div className="text-sm text-zinc-300">{agentName}</div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {status && (
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-4 py-3 text-sm text-zinc-300">
                <div className="flex items-center gap-2">
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  )}
                  {status}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setSelectedType(null)}
                disabled={submitting}
                className="border-zinc-700 bg-transparent"
              >
                Back
              </Button>
              <Button
                disabled={submitting || !runtimeName.trim() || !isConnected || !isBaseSepolia}
                onClick={handleConnect}
                className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
              >
                {submitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="mr-2 h-4 w-4" />
                )}
                Connect Runtime
              </Button>
            </div>
          </div>
        ) : (
          // Step 1: Show provider catalog
          <div className="py-4">
            <p className="text-sm text-zinc-400 mb-4">
              Select a runtime provider to connect to this agent.
            </p>

            {error ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {agentTypes.map((type) => {
                  const visual = providerVisuals[type.id] ?? providerVisuals.custom
                  return (
                    <button
                      key={type.id}
                      onClick={() => setSelectedType(type)}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-left hover:border-zinc-600 hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 p-1">
                          <Image src={visual.logo} alt={type.name} width={28} height={28} className="h-full w-full object-contain" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">{type.name}</div>
                          <div className="text-xs text-zinc-500">{visual.eyebrow}</div>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500 line-clamp-2">{visual.summary}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
