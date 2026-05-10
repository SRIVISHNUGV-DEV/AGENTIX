const footerLinks = {
  Product: [
    { name: "Documentation", href: "/docs" },
    { name: "SDK", href: "/docs/sdk" },
    { name: "Dashboard", href: "/dashboard" },
    { name: "Pricing", href: "/pricing" },
  ],
  Resources: [
    { name: "GitHub", href: "https://github.com/agentix" },
    { name: "Examples", href: "/examples" },
    { name: "Blog", href: "/blog" },
    { name: "Support", href: "/support" },
  ],
  Legal: [
    { name: "Privacy", href: "/privacy" },
    { name: "Terms", href: "/terms" },
    { name: "Security", href: "/security" },
  ],
};

export function FooterSection() {
  return (
    <footer className="py-16 px-6 bg-black border-t border-zinc-900">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between gap-12">
          <div className="md:max-w-xs">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full border border-zinc-700 flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full" />
              </div>
              <span className="text-xl font-bold text-white">Agentix</span>
            </div>
            <p className="text-zinc-500 text-sm">Zero-knowledge credentials for autonomous agent infrastructure.</p>
          </div>
          <div className="flex flex-wrap gap-12 md:gap-16">
            {Object.entries(footerLinks).map(([category, links]) => (
              <div key={category}>
                <h4 className="text-sm font-semibold text-zinc-400 mb-4">{category}</h4>
                <ul className="space-y-3">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a href={link.href} className="text-sm text-zinc-500 hover:text-white transition-colors">{link.name}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-zinc-900 flex flex-col sm:flex-row justify-between items-center gap-4">
          <span className="text-xs text-zinc-600">© 2026 Agentix Protocol</span>
          <span className="text-xs text-zinc-600">Built for the autonomous economy</span>
        </div>
      </div>
    </footer>
  );
}
