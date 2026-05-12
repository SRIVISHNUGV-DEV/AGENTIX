"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition, Suspense } from "react"
import { ArrowLeft, CheckCircle2, Shield, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Header from "@/components/header"
import { useWallet } from "@/components/wallet/wallet-provider"
import { useWalletAction } from "@/lib/wallet-action"

function RegisterAgentForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [agentName, setAgentName] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const { isConnected, isSepolia, account } = useWallet()
  const { post } = useWalletAction()

  // Get orgId from URL params
  const orgId = Number(searchParams.get("orgId") || "1")

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (!isConnected || !isSepolia) {
      setError("Connect your wallet on Sepolia to create an agent")
      return
    }

    const result = await post(
      "/api/platform/agents",
      {
        action: "CREATE_AGENT",
        orgId: orgId,
        target: "agent:new",
      },
      {
        agentName: agentName.trim(),
        description: description.trim() || undefined,
        orgId: orgId,
      }
    )

    if (result.success) {
      const data = result.data as { agentId: number }
      setSuccessMessage(`Agent #${data.agentId} created`)
      setTimeout(() => {
        startTransition(() => {
          router.push(`/agents/${data.agentId}`)
          router.refresh()
        })
      }, 700)
    } else {
      setError(result.error)
    }
  }

  const disabled = isPending || !agentName.trim() || !isConnected || !isSepolia

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/agents">
          <Button variant="ghost" size="sm" className="-ml-2 text-zinc-400 hover:text-zinc-200">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to agents
          </Button>
        </Link>

        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/30 p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800">
              <Shield className="h-5 w-5 text-zinc-200" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Register agent</h1>
              <p className="mt-1 text-sm text-zinc-500">Creates a new protocol agent in your organization. Requires wallet signature.</p>
            </div>
          </div>

          {!isConnected || !isSepolia ? (
            <div className="mt-6 flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
              <AlertCircle className="h-4 w-4" />
              Connect your wallet on Sepolia to create an agent
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          ) : null}

          {successMessage ? (
            <div className="mt-6 flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {successMessage}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Agent name</Label>
              <Input
                id="agent-name"
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                placeholder="Treasury Agent"
                className="border-zinc-700 bg-zinc-900"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-description">Description</Label>
              <textarea
                id="agent-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                placeholder="Operational summary for operators and auditors."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
              />
            </div>

            <div className="space-y-2">
              <Label>Signing Wallet</Label>
              <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-400">
                {account || "Connect wallet"}
              </div>
            </div>

            <div className="flex gap-3">
              <Link href="/agents">
                <Button type="button" variant="outline" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={disabled}
                className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
              >
                {isPending ? "Creating..." : "Create agent"}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}

export default function RegisterAgentPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <Header />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <div className="text-zinc-400">Loading...</div>
        </main>
      </div>
    }>
      <RegisterAgentForm />
    </Suspense>
  )
}
