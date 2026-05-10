import { redirect } from 'next/navigation'

interface LegacyAgentPageProps {
  params: Promise<{ id: string }>
}

export default async function LegacyAgentPage({ params }: LegacyAgentPageProps) {
  const { id } = await params
  redirect(`/agents/${id}`)
}
