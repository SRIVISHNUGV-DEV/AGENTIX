"use client"

import { useState } from "react"
import { Key, Wallet, Clock, Play, ExternalLink, Link2, Unlink2, CheckCircle2, XCircle } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ChatExecutionPanel } from "@/components/execute/chat-execution-panel"
import { WhitelistPanel } from "@/components/agents/whitelist-panel"
import { DepositGasPanel } from "@/components/agents/deposit-gas-panel"
import { ConnectRuntimeModal } from "@/components/agents/connect-runtime-modal"
import { Agent, Session, Event } from "@/lib/types"
import { formatDate, truncateAddress } from "@/lib/utils"
import { getAddressExplorerUrl } from "@/lib/explorer"

interface AgentTabsProps {
  agent: Agent
  sessions: Session[]
  events: Event[]
  onDisconnectRuntime?: () => void
}

type Tab = "credentials" | "wallets" | "sessions" | "execution"

const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "credentials", label: "Credentials", icon: Key },
  { id: "wallets", label: "Wallets", icon: Wallet },
  { id: "sessions", label: "Sessions", icon: Clock },
  { id: "execution", label: "Execute", icon: Play },
]

export function AgentTabs({ agent, sessions, events, onDisconnectRuntime }: AgentTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("credentials")
  const [showConnectModal, setShowConnectModal] = useState(false)

  // Runtime connection status
  const hasConnectedRuntime = agent.linkedExternalAgent && agent.linkedExternalAgent.status === "active"

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === id
                ? "text-white border-b-2 border-white -mb-px"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            suppressHydrationWarning
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === "credentials" && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium flex items-center gap-2">
                <Key className="h-4 w-4 text-zinc-500" />
                Credentials
              </h2>
              <Link href="/credentials">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-zinc-700 bg-transparent hover:bg-zinc-800"
                >
                  Issue New
                </Button>
              </Link>
            </div>
            {agent.credentials.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-zinc-800 rounded-lg">
                <p className="text-sm text-zinc-500">
                  No credentials issued for this agent yet.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {agent.credentials.map((cred) => (
                  <div
                    key={cred.id}
                    className="flex items-center justify-between py-3 border-b border-zinc-800/50 last:border-0"
                  >
                    <div>
                      <div className="font-mono text-sm">
                        {truncateAddress(cred.proofHash, 12)}
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">
                        Permissions: {cred.permissions}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">Expires {formatDate(cred.expiresAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "wallets" && (
          <div className="space-y-6">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-zinc-500" />
                  Wallets
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-zinc-700 bg-transparent hover:bg-zinc-800"
                >
                  Deploy New
                </Button>
              </div>
              {agent.wallets.length === 0 ? (
                <div className="p-6 text-center border border-dashed border-zinc-800 rounded-lg">
                  <p className="text-sm text-zinc-500">
                    No wallets deployed for this agent yet.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {agent.wallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      className="p-4 rounded bg-zinc-800/30 border border-zinc-800"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <a
                          href={getAddressExplorerUrl(wallet.address)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-sm text-zinc-300 hover:text-white hover:underline transition-colors flex items-center gap-1"
                        >
                          {truncateAddress(wallet.address, 16)}
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </a>
                        <span className="text-xs text-zinc-500 uppercase">
                          {wallet.walletKind ?? "ERC-4337"}
                        </span>
                      </div>
                      <WhitelistPanel walletAddress={wallet.address} orgId={parseInt(agent.orgId)} />
                      <DepositGasPanel walletAddress={wallet.address} orgId={parseInt(agent.orgId)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "sessions" && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-zinc-500" />
                Sessions
              </h2>
              <Link href="/sessions">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-zinc-700 bg-transparent hover:bg-zinc-800"
                >
                  Open Session
                </Button>
              </Link>
            </div>
            {sessions.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-zinc-800 rounded-lg">
                <p className="text-sm text-zinc-500">No active sessions for this agent.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between py-3 border-b border-zinc-800/50 last:border-0"
                  >
                    <div>
                      <div className="font-mono text-sm">
                        {truncateAddress(session.sessionKey, 12)}
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">
                        {formatDate(session.createdAt)}
                      </div>
                    </div>
                    <span className="text-xs text-emerald-400">{session.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "execution" && (
          hasConnectedRuntime ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400">Runtime connected (ID: {agent.linkedExternalAgent?.id})</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDisconnectRuntime}
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                >
                  <Unlink2 className="h-4 w-4 mr-1" />
                  Disconnect
                </Button>
              </div>
              <ChatExecutionPanel
                agentId={agent.id}
                externalAgentId={agent.linkedExternalAgent?.id || 0}
                agentName={agent.name}
                orgId={parseInt(agent.orgId)}
                signature={undefined}
                isConnected={true}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="p-8 text-center border border-dashed border-zinc-800 rounded-lg">
                <XCircle className="h-10 w-10 mx-auto mb-4 text-zinc-600" />
                <p className="text-lg font-medium text-zinc-300 mb-2">No Runtime Connected</p>
                <p className="text-sm text-zinc-500 mb-6 max-w-md mx-auto">
                  Connect an external runtime to enable remote execution. Choose from supported providers like Claude Code, LangChain, or your custom agent.
                </p>
                <Button
                  onClick={() => setShowConnectModal(true)}
                  className="bg-white text-black hover:bg-zinc-200"
                >
                  <Link2 className="h-4 w-4 mr-2" />
                  Connect a Runtime
                </Button>
              </div>
            </div>
          )
        )}
      </div>

      {/* Connect Runtime Modal */}
      <ConnectRuntimeModal
        open={showConnectModal}
        onOpenChange={setShowConnectModal}
        protocolAgentId={parseInt(agent.id)}
        orgId={parseInt(agent.orgId)}
        agentName={agent.name}
        onConnected={() => {
          // Refresh the page to show the connected runtime
          window.location.reload()
        }}
      />
    </div>
  )
}
