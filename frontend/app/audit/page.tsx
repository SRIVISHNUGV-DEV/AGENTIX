import { AuditTrailPageClient } from '@/components/audit/audit-trail-page-client'
import { listOrganizations } from '@/lib/mock-api'
import { getSelectedOrgId } from '@/lib/org-session'

export const metadata = {
  title: 'Audit Trail - Agentix',
  description: 'Compliance audit trail for all agent operations, credential actions, and wallet interactions.',
}

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const [orgListRes, selectedOrgId] = await Promise.all([
    listOrganizations(),
    getSelectedOrgId(),
  ])
  const currentOrgId =
    selectedOrgId?.toString() ??
    orgListRes.data[orgListRes.data.length - 1]?.id ??
    null

  return (
    <AuditTrailPageClient
      initialOrgId={currentOrgId}
      organizations={orgListRes.data}
    />
  )
}
