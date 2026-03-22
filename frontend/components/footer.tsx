import Link from 'next/link'

const footerGroups = [
  {
    title: 'Explore',
    links: [
      { href: '/', label: 'Overview' },
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/agents', label: 'Agents' },
      { href: '/events', label: 'Events' },
      { href: '/login', label: 'Login' },
    ],
  },
  {
    title: 'Developer',
    links: [
      { href: '/sdk', label: 'SDK & Self-host' },
      { href: '/sdk#endpoints', label: 'Endpoints' },
      { href: '/sdk#quickstart', label: 'Quickstart' },
      { href: '/dashboard', label: 'Live Data' },
    ],
  },
  {
    title: 'Trust Surface',
    links: [
      { href: '/events', label: 'Event Stream' },
      { href: '/agents', label: 'Agent State' },
      { href: '/dashboard', label: 'Sessions' },
      { href: '/sdk', label: 'Architecture' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#060c12]/85">
      <div className="shell py-14">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
          <div>
            <span className="section-kicker">Built for operators</span>
            <h3 className="max-w-sm text-2xl font-semibold tracking-tight text-foreground">
              Zero-knowledge authorization infrastructure for AI agents.
            </h3>
            <p className="mt-4 max-w-md text-sm leading-7 text-foreground/60">
              The stack combines backend proof orchestration, zk circuits, contract verification, session wallets, and indexed on-chain events into one product surface.
            </p>
          </div>
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-foreground/55">
                {group.title}
              </h4>
              <ul className="mt-4 space-y-3 text-sm">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-foreground/62 transition hover:text-foreground">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-foreground/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Agent Credentials. Private credentials. Public enforcement.</p>
          <p>Live backend, SDK, circuits, contracts, and event indexing are wired into this frontend.</p>
        </div>
      </div>
    </footer>
  )
}
