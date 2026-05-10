import type { Metadata } from 'next'
import type { Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { WalletProvider } from '@/components/wallet/wallet-provider'
import './globals.css'

export const metadata: Metadata = {
  title: "Agentix - Zero-Knowledge Credentials for Autonomous Agents",
  description: "Private agent identity infrastructure for the autonomous economy. Issue verifiable credentials without revealing sensitive data.",
  keywords: ["zero-knowledge", "credentials", "autonomous agents", "blockchain", "ZK proofs"],
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
  themeColor: '#000000',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.querySelectorAll('[fdprocessedid]').forEach(e=>e.removeAttribute('fdprocessedid'))`,
          }}
        />
        <WalletProvider>{children}</WalletProvider>
        <Analytics />
      </body>
    </html>
  )
}
