# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# Audit
- For severity classification: reserve HIGH for actual security exploits; monitoring/observability gaps (e.g., missing events) are Low unless they create a direct attack path. Confidence: 0.65

# Architecture
See [architecture/taste.md](architecture/taste.md)
# Configuration
- Use TOML for configuration files. Confidence: 0.80
- Use JSONL for append-only event logs. Confidence: 0.80
- Use SQLite with WAL mode for persistent structured data. Confidence: 0.80

# Workflow
- Before modifying ZK/credential systems, conduct a thorough multi-file audit exploring all circuits, TypeScript sources, tests, and configs; use a todo list to track multi-step fixes before executing changes. Confidence: 0.65
- After builds or code modifications, clear Next.js build caches and browser caches before restarting dev servers to prevent stale builds from causing issues. Confidence: 0.80
- Use Bun instead of npm for faster package resolving and deployment. Confidence: 0.50
- When multiple valid architectural choices exist, stop and present options with trade-offs (performance, security, maintainability, DX); never silently choose a major architectural direction without explicit approval. Confidence: 0.75
