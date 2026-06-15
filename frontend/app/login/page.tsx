import Link from 'next/link'
import { AuthForm } from '@/components/auth/auth-form'

export const metadata = {
    title: 'Sign In - Agentix',
    description: 'Sign in to access the Agentix dashboard.',
}

export default function LoginPage() {
    return (
        <div className="min-h-screen bg-black text-white">
            <header className="border-b border-zinc-800">
                <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 font-semibold">
                        <div className="w-5 h-5 bg-white rounded-sm flex items-center justify-center">
                            <span className="text-black text-xs font-bold">A</span>
                        </div>
                        <span>Agentix</span>
                    </Link>
                </div>
            </header>

            <main className="mx-auto max-w-lg px-6 py-20">
                <div className="text-center">
                    <span className="text-xs text-zinc-500 uppercase tracking-wider">Agent Identity Platform</span>
                    <h1 className="mt-4 text-3xl font-semibold">Welcome back</h1>
                    <p className="mt-3 text-sm text-zinc-400">
                        Sign in to manage your agents, credentials, and policies.
                    </p>
                </div>

                <div className="mt-8">
                    <AuthForm />
                </div>

                <div className="mt-8 text-center text-xs text-zinc-600">
                    By signing in, you agree to the Agentix Terms of Service.
                </div>
            </main>

            <footer className="border-t border-zinc-800 mt-20">
                <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-zinc-500 text-center">
                    Agentix Protocol • Zero-Knowledge Credentials for Autonomous Agents
                </div>
            </footer>
        </div>
    )
}
