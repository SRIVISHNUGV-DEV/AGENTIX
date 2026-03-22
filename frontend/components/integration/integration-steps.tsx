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
    title: 'Create a client',
    description: 'Point the Agentix SDK at your deployment or hosted backend.',
    code: `import { AgentClient } from '@agentix/sdk';

const client = new AgentClient('http://127.0.0.1:3000');
await client.init();`,
  },
  {
    number: 2,
    title: 'Register an agent',
    description: 'Provision an organization and agent identity through the Agentix API.',
    code: `const registration = await client.registerAgent({
  orgName: 'Acme Treasury',
  agentName: 'Payout Agent',
  permissions: 7,
  expiry: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14,
});

console.log(registration);`,
  },
  {
    number: 3,
    title: 'Create a wallet',
    description: 'Deploy an AgentWallet that can later execute approved session actions.',
    code: `const wallet = await client.createWallet({
  agentId: registration.agentId,
});

console.log(wallet);`,
  },
  {
    number: 4,
    title: 'Create a session',
    description: 'Generate a proof and submit the on-chain session transaction.',
    code: `const session = await client.createSession({
  agentId: registration.agentId,
});

console.log(session);`,
  },
  {
    number: 5,
    title: 'Read state',
    description: 'Pull the latest Agentix state, including wallets, sessions, and events.',
    code: `const state = await client.getAgentState(registration.agentId);
console.log(state);`,
  },
]

export function IntegrationSteps() {
  return (
    <div className="space-y-8">
      {integrationSteps.map((step) => (
        <Card key={step.number} className="overflow-hidden">
          <CardHeader>
            <div className="flex items-start gap-4">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
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
