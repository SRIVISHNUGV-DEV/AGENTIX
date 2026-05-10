'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Mode = 'login' | 'register'

export function AuthForm() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [orgName, setOrgName] = useState('')

  const submit = async () => {
    setError(null)
    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
    const payload =
      mode === 'login'
        ? { email, password }
        : { email, password, name, orgName }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(result.error ?? 'Authentication failed')
      return
    }

    startTransition(() => {
      router.push('/dashboard')
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 rounded-full border border-white/10 bg-white/[0.03] p-1">
        <button
          className={`rounded-full px-4 py-2 text-sm transition ${mode === 'login' ? 'bg-white text-background' : 'text-foreground/60'}`}
          onClick={() => setMode('login')}
          type="button"
        >
          Login
        </button>
        <button
          className={`rounded-full px-4 py-2 text-sm transition ${mode === 'register' ? 'bg-white text-background' : 'text-foreground/60'}`}
          onClick={() => setMode('register')}
          type="button"
        >
          Create org
        </button>
      </div>

      {mode === 'register' ? (
        <>
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Organization name" className="border-white/10 bg-[#0b131c] text-foreground" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="border-white/10 bg-[#0b131c] text-foreground" />
        </>
      ) : null}

      <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" className="border-white/10 bg-[#0b131c] text-foreground" />
      <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" className="border-white/10 bg-[#0b131c] text-foreground" />

      <Button
        disabled={isPending}
        className="w-full rounded-full bg-accent text-accent-foreground hover:bg-accent/90"
        onClick={submit}
      >
        {mode === 'login' ? 'Login to workspace' : 'Create organization account'}
      </Button>

      {error ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
    </div>
  )
}
