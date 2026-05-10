import type { Metadata } from 'next'
import type { Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { WalletProvider } from '@/components/wallet/wallet-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agentix - Private Credentials and Session Control for AI Agents',
  description:
    'Agentix is a protocol and operator platform for issuing private agent credentials, verifying them with zero knowledge, and controlling on-chain sessions.',
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
