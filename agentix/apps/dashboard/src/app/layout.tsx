import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AGENTIX — AI Agent Operating System",
  description: "Local-first AI agent credential protocol runtime",
};

/**
 * Root html/body shell for every dashboard route.
 * @param children - The page content rendered inside <body>.
 * @returns The <html lang="en"> document shell; `suppressHydrationWarning` is set because the theme class is toggled client-side after mount.
 * Maps to: component Dashboard (app/page.tsx); Maps to: internal — globals.css (imported here for its side effect).
 * Side effects: imports the global stylesheet.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
