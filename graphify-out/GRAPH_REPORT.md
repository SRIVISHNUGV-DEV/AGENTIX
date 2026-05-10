# Graph Report - .  (2026-05-09)

## Corpus Check
- 1 files · ~469 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 27 nodes · 50 edges · 5 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]

## God Nodes (most connected - your core abstractions)
1. `Backend Workspace` - 14 edges
2. `Project Overview: Agentix` - 9 edges
3. `Frontend Workspace` - 9 edges
4. `Contracts Workspace` - 5 edges
5. `Circuits Workspace` - 4 edges
6. `SQLite Database` - 4 edges
7. `Session 1: Repo Structure` - 4 edges
8. `Data Flow: Frontend to Database` - 4 edges
9. `Agent Identity Flow: Contracts to Backend` - 4 edges
10. `SDK Workspace` - 3 edges

## Surprising Connections (you probably didn't know these)
- `Backend Workspace` --creates--> `Session 1: Repo Structure`  [EXTRACTED]
  AGENTS.md → AGENTS.md  _Bridges graph structure (betweenness=0.151)_
- `Frontend Workspace` --depends_on--> `Backend Workspace`  [EXTRACTED]
  AGENTS.md → AGENTS.md  _Bridges graph structure (betweenness=0.145)_
- `Backend Workspace` --depends_on--> `Circuits Workspace`  [EXTRACTED]
  AGENTS.md → AGENTS.md  _Bridges graph structure (betweenness=0.095)_
- `Backend Workspace` --constrains--> `Alchemy Free Tier Rate Limits`  [EXTRACTED]
  AGENTS.md → AGENTS.md  _Bridges graph structure (betweenness=0.085)_
- `Backend Workspace` --depends_on--> `Contracts Workspace`  [EXTRACTED]
  AGENTS.md → AGENTS.md  _Bridges graph structure (betweenness=0.078)_

## Hyperedges (group relationships)
- **Data Flow Pipeline** — agents_workspace_frontend, agents_workspace_sdk, agents_workspace_backend, agents_sqlite_database [EXTRACTED 1.00]
- **ZK Proof Pipeline** — agents_workspace_circuits, agents_zk_proof_orchestration, agents_workspace_contracts [EXTRACTED 1.00]
- **Agent Identity Pipeline** — agents_workspace_contracts, agents_workspace_backend, agents_sqlite_database [EXTRACTED 1.00]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.43
Nodes (7): Express Backend Stack, Next.js Frontend Stack, npm Workspaces Architecture, Project Overview: Agentix, Protocol-Style README Architecture, Session 1: Repo Structure, Session 2: Public README Rewrite

### Community 1 - "Community 1"
Cohesion: 0.52
Nodes (7): Agent Identity Flow: Contracts to Backend, Alchemy Free Tier Rate Limits, Data Flow: Frontend to Database, Session 2: Event Sync Limits, SQLite Database, Backend Workspace, SDK Workspace

### Community 2 - "Community 2"
Cohesion: 0.47
Nodes (6): Session 2: Agent Flow Unification, Session 2: Environment Configuration, Session 2: Health Check, Session 2: Route Redirect, Session 2: Provider Fleet Onboarding, Frontend Workspace

### Community 3 - "Community 3"
Cohesion: 0.67
Nodes (4): Circom ZK Circuits Stack, Circuits Workspace, ZK Proof Flow: Circuits to Contracts, ZK Proof Orchestration

### Community 4 - "Community 4"
Cohesion: 0.67
Nodes (3): Session 2: Linked Agent ID Field, Solidity Contracts Stack, Contracts Workspace

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects Core Tech Stack components?**
  _They form the foundation_
- **How do Session 2 changes relate to workspaces?**
  _Session 2 tracks features_