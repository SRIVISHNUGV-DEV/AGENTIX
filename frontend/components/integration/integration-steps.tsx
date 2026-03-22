'use client'

import { CodeBlock } from '@/components/common/code-block'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2 } from 'lucide-react'

interface IntegrationStep {
  number: number
  title: string
  description: string
  code: string
}

const integrationSteps: IntegrationStep[] = [
  {
    number: 1,
    title: 'Initialize Agent',
    description: 'Create a new agent instance with your organization credentials',
    code: `import { AgentCredentials } from '@agent-credentials/sdk';

const agent = new AgentCredentials({
  orgId: 'org_1a2b3c4d5e6f7g8h9i0j',
  apiKey: 'sk_live_...',
});`,
  },
  {
    number: 2,
    title: 'Issue Credential',
    description: 'Issue a zero-knowledge credential to authorize the agent',
    code: `const credential = await agent.issueCredential({
  type: 'AUTHORIZATION',
  expiresIn: '365d',
  scope: ['transaction:sign', 'wallet:read'],
});

console.log('Credential ID:', credential.id);`,
  },
  {
    number: 3,
    title: 'Register Wallet',
    description: 'Register a blockchain wallet for the agent to use',
    code: `const wallet = await agent.registerWallet({
  address: '0x742d35Cc6634C0532925a3b844Bc1e7595f2d90d',
  chain: 'ethereum',
  credentialId: credential.id,
});

console.log('Wallet registered:', wallet.id);`,
  },
  {
    number: 4,
    title: 'Create Session',
    description: 'Create a session to enable transaction signing',
    code: `const session = await agent.createSession({
  credentialId: credential.id,
  walletId: wallet.id,
  expiresIn: '24h',
});

console.log('Session created:', session.sessionKey);`,
  },
  {
    number: 5,
    title: 'Sign Transaction',
    description: 'Use the session to sign and execute transactions',
    code: `const signature = await agent.signTransaction({
  sessionId: session.id,
  transaction: {
    to: '0x...',
    value: '1.5',
    data: '0x...',
  },
});

console.log('Transaction signed:', signature.txHash);`,
  },
]

export function IntegrationSteps() {
  return (
    <div className="space-y-8">
      {integrationSteps.map(step => (
        <Card key={step.number} className="overflow-hidden">
          <CardHeader>
            <div className="flex items-start gap-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground flex-shrink-0">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Step {step.number}: {step.title}
                </CardTitle>
                <CardDescription className="mt-2">{step.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <CodeBlock code={step.code} language="typescript" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
