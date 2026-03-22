import type { Metadata } from 'next'
import type { Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { WalletProvider } from '@/components/wallet/wallet-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agent Credentials - Zero-Knowledge Proof Authorization for AI Agents',
  description:
    'Securely authorize and manage AI agent access without exposing private credentials. Built for Web3, designed for trust.',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#050505',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <WalletProvider>{children}</WalletProvider>
        <Analytics />
      </body>
    </html>
  )
}
