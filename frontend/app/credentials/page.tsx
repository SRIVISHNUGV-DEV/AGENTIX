import Link from 'next/link'
import { ArrowRight, KeyRound, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCredentials, getOrganizationWorkspace, listOrganizations } from '@/lib/mock-api'
import { getSelectedOrgId } from '@/lib/org-session'
import { formatDate, truncateAddress } from '@/lib/utils'
import Header from '@/components/header'

export const metadata = {
  title: 'Credentials - Agentix',
  description: 'Issued credential commitments for the active workspace.',
}

export const dynamic = 'force-dynamic'

export default async function CredentialsPage() {
  const [organizationsRes, selectedOrgId] = await Promise.all([
    listOrganizations(),
    getSelectedOrgId(),
  ])
  const currentOrgId =
    selectedOrgId?.toString() ??
    organizationsRes.data[organizationsRes.data.length - 1]?.id ??
    null
  const [credentialsRes, workspaceRes] = await Promise.all([
    getCredentials(),
    currentOrgId ? getOrganizationWorkspace(currentOrgId) : Promise.resolve(null),
  ])
  const credentials = currentOrgId
    ? credentialsRes.data.filter((credential) => credential.issuer === `org-${currentOrgId}`)
    : credentialsRes.data

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Workspace</span>
            <h1 className="mt-2 text-3xl font-semibold">Credential ledger</h1>
            <p className="mt-3 max-w-2xl text-sm text-zinc-400">
              These are the active and expired credential commitments indexed from the PostgreSQL backend for
              {workspaceRes?.data.organization ? ` ${workspaceRes.data.organization.name}` : ' the current workspace'}.
            </p>
          </div>
          <Link href="/credentials/issue">
            <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">Issue credential</Button>
          </Link>
        </div>

        {credentials.length === 0 ? (
          <div className="mt-10 rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
            <KeyRound className="mx-auto h-10 w-10 text-zinc-600" />
            <h2 className="mt-4 text-lg font-medium">No credentials issued</h2>
            <p className="mt-2 text-sm text-zinc-500">
              Open an agent and use the signed action panel to create its first credential.
            </p>
            <div className="mt-6">
              <Link href="/agents">
                <Button className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200">Open agents</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-10 grid gap-4">
            {credentials.map((credential) => (
              <div key={credential.id} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800">
                      <Shield className="h-5 w-5 text-zinc-300" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-medium">Agent #{credential.agentId}</span>
                        <span className={credential.status === 'active' ? 'text-emerald-400 text-sm' : 'text-zinc-500 text-sm'}>
                          {credential.status}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-zinc-500">
                        Proof {truncateAddress(credential.proofHash, 18)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
                        <span>Issued {formatDate(credential.issuedAt)}</span>
                        <span>Expires {formatDate(credential.expiresAt)}</span>
                        <span>Permissions {credential.permissions ?? 0}</span>
                      </div>
                    </div>
                  </div>
                  <Link href={`/agents/${credential.agentId}`}>
                    <Button variant="outline" className="border-zinc-700 bg-transparent hover:bg-zinc-800">
                      Open agent
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
