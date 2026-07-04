# AgentIX Dashboard — Master Fix Prompt

## Context

AgentIX is a local-first AI agent credential protocol runtime with a Next.js 14 dashboard at `apps/dashboard/` and a raw Node.js HTTP API server at `src/runtime/server.ts`. A thorough security and UX audit identified **7 critical/high security vulnerabilities, 9 broken features, and 8 UX issues**. This prompt covers every fix in priority order.

**Architecture reference:**
- Dashboard: `apps/dashboard/src/` (Next.js 14, Tailwind, Framer Motion)
- API Server: `src/runtime/server.ts` (raw `http.createServer`, port 3001)
- Blockchain adapter: `src/blockchain/adapter.ts`
- Config: `src/core/config.ts` (loads from `~/.agentix/config/agentix.config.json`)
- Database: `src/core/database.ts` (SQLite via better-sqlite3)
- Bundler: `src/runtime/bundler.ts` (ERC-4337 relay)

---

## PHASE 1: CRITICAL SECURITY (blocks launch)

### 1.1 — Lock CORS to localhost only

**File:** `src/runtime/server.ts`

Replace every `"Access-Control-Allow-Origin": "*"` with `"Access-Control-Allow-Origin": "http://localhost:3000"`. This appears in THREE places:
- The `json()` helper function (~line 20)
- The OPTIONS preflight handler (~line 40)
- Any other manual `writeHead` calls

After fix, verify with:
```bash
curl -v -X OPTIONS http://localhost:3001/api/health -H "Origin: http://evil.com"
# Should NOT contain Access-Control-Allow-Origin: http://evil.com
```

### 1.2 — Stop sending agent private key to server

**File:** `apps/dashboard/src/lib/tx-sender.ts` (function `bundleAgentExecute`, ~line 301)

The `agentPrivateKey` is sent to `/api/bundler/send` in plaintext. The server then uses it in `src/runtime/bundler.ts` (`buildSessionUserOp`, ~line 109) to sign UserOperations.

**Fix approach:**
1. Move the `buildSessionUserOp` function from `src/runtime/bundler.ts` into a new client-side file `apps/dashboard/src/lib/userop-builder.ts`
2. In `tx-sender.ts`, import `buildSessionUserOp` from the new file
3. Build and sign the UserOp entirely in the browser
4. Send only the pre-signed UserOp to `/api/bundler/send`
5. Update `/api/bundler/send` in `server.ts` (~line 336) to accept a pre-signed UserOp and skip `buildSessionUserOp`

The new `/api/bundler/send` handler should look like:
```typescript
if (path === "/api/bundler/send" && req.method === "POST") {
  const body = await parseBody(req);
  const { bundleUserOp } = await import("./bundler");
  // userOp is already signed client-side — just relay it
  const result = await bundleUserOp(body.userOp);
  return json(res, result, result.success ? 200 : 400);
}
```

The new client-side `userop-builder.ts` should contain the logic currently in `bundler.ts:buildSessionUserOp` plus the ethers import.

### 1.3 — Add local-only authentication

**File:** `src/runtime/server.ts`

Add auth middleware at the top of the request handler (after OPTIONS handling):

1. On server startup, generate a random token:
```typescript
import { randomBytes, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const AUTH_TOKEN_PATH = join(process.env.HOME || process.env.USERPROFILE || "", ".agentix", ".auth-token");

function getAuthToken(): string {
  if (existsSync(AUTH_TOKEN_PATH)) {
    return readFileSync(AUTH_TOKEN_PATH, "utf-8").trim();
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(AUTH_TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

const AUTH_TOKEN = getAuthToken();
```

2. Add auth check after OPTIONS handling:
```typescript
// Auth check for mutating endpoints
if (req.method !== "GET" && req.method !== "OPTIONS") {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
    return json(res, { error: "Unauthorized" }, 401);
  }
}
```

3. Add localhost-only check for ALL requests:
```typescript
const clientIp = req.socket.remoteAddress || "";
if (!clientIp.includes("127.0.0.1") && !clientIp.includes("::1") && !clientIp.includes("localhost")) {
  return json(res, { error: "Only localhost access allowed" }, 403);
}
```

4. In the dashboard, read the auth token. Create a new file `apps/dashboard/src/lib/auth.ts`:
```typescript
// Read auth token from ~/.agentix/.auth-token
// Pass it as Authorization header on all mutating requests
```
Update `api.ts` `request()` function to include the auth header from this module.

### 1.4 — Protect debug endpoint

**File:** `src/runtime/server.ts` (~line 348)

Gate `/api/debug/simulate` behind the `developerMode` config flag AND localhost check:
```typescript
if (path === "/api/debug/simulate" && req.method === "POST") {
  const config = loadConfig();
  if (!config.developerMode) {
    return json(res, { error: "Debug endpoint disabled" }, 403);
  }
  // ... existing logic
}
```

### 1.5 — Filter sensitive data from config response

**File:** `src/runtime/server.ts` (~line 610)

```typescript
if (path === "/api/config" && req.method === "GET") {
  const config = loadConfig();
  // Never expose RPC URL or private key paths to the frontend
  const safe = { ...config };
  if (safe.rpcUrl) safe.rpcUrl = "***configured***";
  if (safe.privateKey) safe.privateKey = "***redacted***";
  return json(res, safe);
}
```

### 1.6 — Add request body size limit

**File:** `src/runtime/server.ts` (function `parseBody`, ~line 27)

```typescript
function parseBody(req: http.IncomingMessage, maxBytes = 1_048_576): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}
```

Update all `parseBody(req)` calls to catch the rejection.

### 1.7 — Add basic rate limiting

**File:** `src/runtime/server.ts`

Add a simple in-memory rate limiter at the top of the request handler:
```typescript
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, limit = 100, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}
```

Call it after the auth check, before route handling.

---

## PHASE 2: BROKEN FUNCTIONALITY

### 2.1 — Replace hardcoded localhost:3001

**File:** `apps/dashboard/src/app/page.tsx` (~line 154)

Change:
```typescript
fetch('http://localhost:3001/api/onboarding/status')
```
to:
```typescript
import { API } from '@/lib/api';
// ...
fetch(`${API}/api/onboarding/status`)
```

**File:** `apps/dashboard/src/sections/onboarding.tsx` (~line 529)

Change:
```typescript
<a href="http://localhost:3001" ...>
```
to:
```typescript
<a href={API} ...>
```
(Import `API` from `@/lib/api` which is already imported on line 5.)

### 2.2 — Wire up Credentials page

**File:** `apps/dashboard/src/app/page.tsx`

1. Add import (if missing):
```typescript
import { CredentialsPage } from '@/sections/credentials';
```

2. Add to PAGES object (~line 29):
```typescript
credentials: CredentialsPage,
```

3. Add to PAGE_LABELS (~line 49):
```typescript
credentials: 'Credentials',
```

### 2.3 — Wire up Identities page

**File:** `apps/dashboard/src/app/page.tsx`

1. Add import (if missing):
```typescript
import { IdentitiesPage } from '@/sections/identities';
```

2. Add to PAGES:
```typescript
identities: IdentitiesPage,
```

3. Add to PAGE_LABELS:
```typescript
identities: 'Identities',
```

### 2.4 — Fix session revocation HTTP method

**File:** `apps/dashboard/src/sections/sessions.tsx` (~line 77)

The current code sends POST but the server expects DELETE:
```typescript
// WRONG:
await postJSON('/api/sessions', { sessionId, walletAddress });
```

Fix:
```typescript
import { fetchJSON, postJSON, deleteJSON, truncate } from '@/lib/api';
// ...
await deleteJSON('/api/sessions', { sessionId, walletAddress });
```

### 2.5 — Fix theme hydration flash

**File:** `apps/dashboard/src/app/page.tsx` (~line 133)

Replace:
```typescript
const [theme, setTheme] = useState<'light' | 'dark'>('dark');
```
with:
```typescript
const [theme, setTheme] = useState<'light' | 'dark'>(() => {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem('agentix-theme') as 'light' | 'dark') || 'dark';
});
```

Remove the first `useEffect` that loads theme from localStorage (~lines 135-139). Keep only the second useEffect that toggles the class and saves.

### 2.6 — Allow dashboard when API is offline

**File:** `apps/dashboard/src/app/page.tsx` (~lines 148-158)

Replace the onboarding check:
```typescript
useEffect(() => {
  if (typeof window !== 'undefined' && window.location.pathname === '/onboarding') {
    setShowOnboarding(true);
    setOnboardingLoading(false);
    return;
  }
  fetch(`${API}/api/onboarding/status`)
    .then(r => r.json())
    .then(d => { if (!d.initialized || !d.rpcConfigured) setShowOnboarding(true); })
    .catch(() => setShowOnboarding(true))  // <-- THIS IS THE PROBLEM
    .finally(() => setOnboardingLoading(false));
}, []);
```

With:
```typescript
useEffect(() => {
  if (typeof window !== 'undefined' && window.location.pathname === '/onboarding') {
    setShowOnboarding(true);
    setOnboardingLoading(false);
    return;
  }
  fetch(`${API}/api/onboarding/status`)
    .then(r => r.json())
    .then(d => {
      if (!d.initialized || !d.rpcConfigured) setShowOnboarding(true);
    })
    .catch(() => {
      // API offline — show dashboard with offline banner, NOT onboarding
      setApiOffline(true);
    })
    .finally(() => setOnboardingLoading(false));
}, []);
```

Add state: `const [apiOffline, setApiOffline] = useState(false);`

Add an offline banner in the header when `apiOffline` is true:
```typescript
{apiOffline && (
  <div className="bg-warning/10 border-b border-warning/20 px-6 py-1.5 text-[10px] text-warning text-center">
    API server offline — some features unavailable
  </div>
)}
```

### 2.7 — Show real session count in wallet details

**File:** `apps/dashboard/src/sections/wallets.tsx`

1. Add sessions state:
```typescript
const [sessions, setSessions] = useState<any[]>([]);
```

2. Fetch sessions alongside wallets:
```typescript
const fetchData = async () => {
  setLoading(true);
  try {
    const [walletData, sessionData] = await Promise.allSettled([
      fetchJSON<any>('/api/wallets'),
      fetchJSON<any>('/api/sessions/all'),
    ]);
    if (walletData.status === 'fulfilled') setWallets(walletData.value.value || walletData.value || []);
    if (sessionData.status === 'fulfilled') setSessions(sessionData.value.value || sessionData.value || []);
  } catch (e) { console.error(e); }
  setLoading(false);
};
```

3. Replace hardcoded "0 sessions" (~line 92):
```typescript
<div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
  <KeyRound className="w-3.5 h-3.5" />
  {sessions.filter((s: any) => s.wallet_address === selected.wallet_address).length} sessions
</div>
```

### 2.8 — Load contract addresses dynamically in Developer page

**File:** `apps/dashboard/src/sections/developer.tsx`

Replace hardcoded ABIs:
```typescript
const ABIS = [
  { name: 'AgentWalletFactory', address: '0x9e6B...FfE3' },
  // ...
];
```

With:
```typescript
const [abis, setAbis] = useState<any[]>([]);

useEffect(() => {
  fetchJSON<any>('/api/contracts')
    .then(data => setAbis(data.value || data || []))
    .catch(() => {});
}, []);
```

And render from `abis` instead of the hardcoded array.

### 2.9 — Add Credentials and Identities to sidebar

**File:** `apps/dashboard/src/components/sidebar.tsx` (~line 17)

Add to NAV_ITEMS array:
```typescript
{ id: 'credentials', label: 'Credentials', icon: CreditCard, group: 'Protocol' },
{ id: 'identities', label: 'Identities', icon: User, group: 'Protocol' },
```

Import `CreditCard` and `User` from lucide-react (CreditCard is already used in the file's icon set, User needs adding).

---

## PHASE 3: UX IMPROVEMENTS

### 3.1 — Add React Error Boundary

Create `apps/dashboard/src/components/error-boundary.tsx`:
```typescript
'use client';
import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive/40 mb-3" />
          <p className="text-sm font-medium mb-1">Something went wrong</p>
          <p className="text-xs text-muted-foreground/60 mb-4">{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="w-3 h-3" /> Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Wrap the main content in `apps/dashboard/src/app/page.tsx`:
```typescript
import { ErrorBoundary } from '@/components/error-boundary';
// ...
<main className="flex-1 p-6 overflow-auto">
  <Breadcrumbs page={activePage} />
  <ErrorBoundary key={activePage}>
    <Page />
  </ErrorBoundary>
</main>
```

### 3.2 — Replace alert() with Toast system

**Files:** All section files that use `alert()`:
- `wallets.tsx` (~line 33)
- `credentials.tsx` (~lines 74-78)

Create a toast context. In `apps/dashboard/src/lib/toast-context.tsx`:
```typescript
'use client';
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  const showToast = useCallback((message: string, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);
  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
          <div className={`px-4 py-2.5 rounded-lg border text-xs shadow-lg ${
            toast.type === 'error' ? 'bg-destructive/10 border-destructive/20 text-destructive' :
            toast.type === 'success' ? 'bg-success/10 border-success/20 text-success' :
            'bg-background border-border'
          }`}>
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
```

Wrap in `ClientProvider`:
```typescript
// apps/dashboard/src/lib/client-provider.tsx
import { ToastProvider } from './toast-context';
export function ClientProvider({ children }: { children: ReactNode }) {
  return <Web3ModalProvider><ToastProvider>{children}</ToastProvider></Web3ModalProvider>;
}
```

Then in section files, replace `alert(msg)` with `useToast().showToast(msg, 'error')`.

### 3.3 — Add responsive sidebar

**File:** `apps/dashboard/src/app/page.tsx`

Add mobile state:
```typescript
const [sidebarOpen, setSidebarOpen] = useState(false);
```

Add hamburger button in the header (visible only on mobile):
```typescript
<button onClick={() => setSidebarOpen(!sidebarOpen)}
  className="md:hidden p-1.5 rounded-lg hover:bg-accent transition-colors">
  <Menu className="w-4 h-4" />
</button>
```

Pass `sidebarOpen` and `onClose` to Sidebar, and add responsive classes:
```typescript
// In Sidebar component, wrap aside with:
<aside className={cn(
  "sidebar-desktop h-screen sticky top-0 flex flex-col border-r border-border bg-[hsl(var(--sidebar-bg))] overflow-hidden",
  "max-md:fixed max-md:z-50 max-md:transition-transform max-md:duration-200",
  sidebarOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"
)}>
```

Add a backdrop overlay on mobile when sidebar is open.

### 3.4 — Implement command palette search

**File:** `apps/dashboard/src/components/command-palette.tsx`

Add a search input at the top that filters the page list:
```typescript
const [query, setQuery] = useState('');
const filtered = pages.filter(p => p.label.toLowerCase().includes(query.toLowerCase()));
```

Render filtered results and allow keyboard navigation (arrow keys + Enter).

### 3.5 — Add validation to bundler execute dialog

**File:** `apps/dashboard/src/sections/agents.tsx` (~line 446)

Add validation before submit:
```typescript
const handleAgentExecute = async () => {
  if (!execTarget || !execTarget.startsWith('0x') || execTarget.length !== 42) {
    setError('Enter a valid target address (0x...)');
    return;
  }
  // ... rest of logic
};
```

---

## PHASE 4: VERIFICATION CHECKLIST

After all fixes, verify:

1. **Security:**
   - [ ] `curl -v -X OPTIONS http://localhost:3001/api/health -H "Origin: http://evil.com"` — no CORS header for evil.com
   - [ ] `GET /api/config` — rpcUrl shows "***configured***"
   - [ ] `POST /api/bundler/send` without auth token — returns 401
   - [ ] `/api/debug/simulate` with developerMode=false — returns 403
   - [ ] POST body >1MB — returns error

2. **Functionality:**
   - [ ] Dashboard loads when API server is offline (shows banner)
   - [ ] Credentials page accessible from sidebar and renders
   - [ ] Identities page accessible from sidebar and renders
   - [ ] Session revocation works (click Revoke → session disappears)
   - [ ] Theme persists across reload without flash
   - [ ] Contract addresses in Developer page match actual deployment

3. **Build:**
   - [ ] `cd apps/dashboard && npm run build` — compiles clean
   - [ ] No TypeScript errors
   - [ ] No ESLint errors

4. **UX:**
   - [ ] Error boundary catches render errors (test by throwing in a component)
   - [ ] Toast appears instead of browser alert
   - [ ] Sidebar collapses on mobile with hamburger menu
   - [ ] Command palette filters pages as you type
