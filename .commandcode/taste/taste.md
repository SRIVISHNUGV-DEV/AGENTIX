# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/


# Audit
- For severity classification: reserve HIGH for actual security exploits; monitoring/observability gaps (e.g., missing events) are Low unless they create a direct attack path. Confidence: 0.65

# Architecture
See [architecture/taste.md](architecture/taste.md)

# Solidity
- Use a 2-day timelock delay for upgradeable contract proposals (SessionManager, AgentWallet, AgentWalletFactory, OrganizationRegistry). Confidence: 0.80
# Configuration
- Use TOML for configuration files. Confidence: 0.80
- Use JSONL for append-only event logs. Confidence: 0.80
- Use SQLite with WAL mode for persistent structured data. Confidence: 0.80

# Workflow
- For release validation or audit work: use a structured, role-based prompt (e.g., "release engineering team preparing for a public beta") with explicit negatives (what NOT to do), numbered phases, required deliverables, and measurable success criteria — never generic instructions like "fix bugs." Confidence: 0.75
- Before modifying ZK/credential systems, conduct a thorough multi-file audit exploring all circuits, TypeScript sources, tests, and configs; use a todo list to track multi-step fixes before executing changes. Confidence: 0.65
- After builds or code modifications, clear Next.js build caches and browser caches before restarting dev servers to prevent stale builds from causing issues. Confidence: 0.80
- Use Bun instead of npm for faster package resolving and deployment. Confidence: 0.50
- When multiple valid architectural choices exist, stop and present options with trade-offs (performance, security, maintainability, DX); never silently choose a major architectural direction without explicit approval. Confidence: 0.75
