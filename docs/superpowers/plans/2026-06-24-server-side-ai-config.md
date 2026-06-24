# Server-side AI Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the AI provider configuration (base URL, API key, model) from a per-user client-side settings panel into server-side environment variables, and remove the panel.

**Architecture:** A new `app/api/feedback/config.ts` module reads and validates `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` at module load, then exports a singleton `OpenAI` client. The route handler imports the client and the model, drops all per-request provider config, and rejects any body that still carries the legacy `apiKey`/`baseUrl`/`model` fields. The client UI loses its Settings panel and ships only `copy` in the request body.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, `openai` SDK 6, ESLint 9.

**Spec:** `docs/superpowers/specs/2026-06-24-server-side-ai-config-design.md`

**Note on testing:** The project has no test framework and the spec lists adding one as out of scope. Each task includes a manual verification step with concrete commands and expected outputs instead of automated tests.

**Prerequisite reading for the implementer:** This repo uses a version of Next.js with breaking changes (see `AGENTS.md`). Read these before touching code:
- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md` — how `.env` and `process.env` are loaded in route handlers.
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` — the current route handler shape (the existing `app/api/feedback/route.ts` already follows it; confirm it has not changed).

## File Structure

- **Create `app/api/feedback/config.ts`** — single responsibility: read and validate the three AI env vars at module load, export a singleton `OpenAI` client plus the resolved `model` and `baseUrl`. Throws on missing/invalid config.
- **Modify `app/api/feedback/route.ts`** — drop the `apiKey`/`baseUrl`/`model` fields from the body contract, reject any request that still includes them, use the imported client and model.
- **Modify `app/page.tsx`** — delete the Settings panel, all related state and helpers, the `localStorage` reads, the BYOK footer, and the legacy fields in the request body. Keep `copiedKey` (used by the feedback copy buttons).
- **Create `.env.example`** — documents the three required env vars with safe placeholder values. Safe to commit because `.env*` is already in `.gitignore` (line 34).

## Task Dependency Order

Task 1 → Task 2 → Task 3. Task 4 is independent and can be done any time. The dependency is real: after Task 1 the server is configured, after Task 2 the route accepts copy-only bodies, and only then is it safe to strip the client UI in Task 3.

---

## Task 1: Add server config module

**Files:**
- Create: `app/api/feedback/config.ts`

- [ ] **Step 1: Create the config module**

Write `app/api/feedback/config.ts` with this exact content:

```typescript
import OpenAI from "openai";

const baseUrl = process.env.AI_BASE_URL;
const apiKey = process.env.AI_API_KEY;
const model = process.env.AI_MODEL;

if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
  throw new Error(
    "Server misconfigured: AI_BASE_URL is missing. Set it in the environment before starting the server."
  );
}
if (!/^https?:\/\//.test(baseUrl)) {
  throw new Error(
    `Server misconfigured: AI_BASE_URL must start with http:// or https:// (got "${baseUrl}").`
  );
}
if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
  throw new Error(
    "Server misconfigured: AI_API_KEY is missing. Set it in the environment before starting the server."
  );
}
if (typeof model !== "string" || model.trim().length === 0) {
  throw new Error(
    "Server misconfigured: AI_MODEL is missing. Set it in the environment before starting the server."
  );
}

const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

export const client = new OpenAI({
  apiKey,
  baseURL: normalizedBaseUrl,
});

export { model, normalizedBaseUrl as baseUrl };
```

- [ ] **Step 2: Verify the module fails fast when env is missing**

Run:
```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
unset AI_BASE_URL AI_API_KEY AI_MODEL
timeout 15 npm run dev 2>&1 | tee /tmp/lpf-noenv.log
```

Expected: the log contains one of the `Server misconfigured: ...` lines (the first one — `AI_BASE_URL is missing`) within a few seconds, and the dev server fails to start serving requests. If the server instead starts cleanly, the validation is not firing; re-check that the file is at the exact path above and that the route handler imports it (it doesn't yet — the import is added in Task 2, but the file is also reachable directly).

Note: with the route handler not yet importing this module (Task 2 adds the import), the failure may only surface when the route is first compiled. To force a compile, hit the route:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"copy":"hello world hello world hello world hello"}'
```
Then read `/tmp/lpf-noenv.log` and confirm the `Server misconfigured` message appears.

Press `Ctrl+C` (or let `timeout` expire) to stop the dev server.

- [ ] **Step 3: Verify the module loads cleanly with valid env**

Create a temporary `.env` at the project root with safe test values (this file is gitignored):
```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
cat > .env <<'EOF'
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-test-dummy-key-for-config-load-check
AI_MODEL=gpt-4o-mini
EOF
```

Run:
```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
npm run dev 2>&1 | tee /tmp/lpf-goodenv.log
```

In a second terminal, force the route to compile:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"copy":"hello world hello world hello world hello"}'
```

Expected: dev server starts; the log does NOT contain `Server misconfigured`; the request returns either 502 (because the test key is fake) or 400 (because the body validation in the existing route still requires `apiKey`/`baseUrl`/`model` — both are acceptable for this task; the key is that the server did not crash on import).

Stop the dev server, then delete the temporary `.env`:
```bash
rm /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback/.env
```

- [ ] **Step 4: Commit**

```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
git add app/api/feedback/config.ts
git commit -m "Add server-side AI configuration module"
```

---

## Task 2: Update route handler to use the config and reject legacy fields

**Files:**
- Modify: `app/api/feedback/route.ts` (replace the `import OpenAI from "openai";` line, update the POST handler body parsing and OpenAI client construction)

- [ ] **Step 1: Replace the `OpenAI` import**

In `app/api/feedback/route.ts`, line 1 currently reads:
```typescript
import OpenAI from "openai";
```

Replace it with:
```typescript
import { client, model } from "./config";
```

- [ ] **Step 2: Replace the body parsing and validation block**

In `app/api/feedback/route.ts`, replace the entire block from line 131 (the `const { copy, apiKey, baseUrl, model } = ...` line) through line 158 (the closing brace of the `model` length check) with the following. This removes the per-request provider validation, adds a legacy-field check, and keeps the `copy` validation.

```typescript
  const bodyObj = (body ?? {}) as Record<string, unknown> & { copy?: unknown };
  const { copy } = bodyObj;

  const FORBIDDEN_KEYS = ["apiKey", "baseUrl", "model"] as const;
  const present = FORBIDDEN_KEYS.filter((k) => k in bodyObj);
  if (present.length > 0) {
    return Response.json(
      {
        error: `This endpoint no longer accepts ${present.join(", ")}. Configure the server with AI_BASE_URL, AI_API_KEY, and AI_MODEL.`,
      },
      { status: 400 },
    );
  }

  if (typeof copy !== "string" || copy.trim().length < 20) {
    return Response.json(
      { error: "Please paste at least a sentence of landing page copy." },
      { status: 400 },
    );
  }
```

- [ ] **Step 3: Remove the per-request client construction**

In `app/api/feedback/route.ts`, delete the block currently at lines 177–185:

```typescript
  let client: OpenAI;
  try {
    client = new OpenAI({ apiKey, baseURL: baseUrl.replace(/\/+$/, "") });
  } catch (err) {
    return Response.json(
      { error: `Could not create API client: ${(err as Error).message}` },
      { status: 400 },
    );
  }
```

Replace it with nothing — the `client` symbol is now the imported singleton. Leave the `try {` that wraps the OpenAI API call below it intact (it catches provider errors and still belongs).

- [ ] **Step 4: Verify lint and typecheck**

Run:
```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
npm run lint
```

Expected: no errors. If ESLint reports an unused `apiKey`/`baseUrl`/`model` symbol, the destructuring in Step 2 was not replaced correctly — re-check that you kept only `copy` from the body.

Run:
```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
npx tsc --noEmit
```

Expected: no errors. The `OpenAI` import is gone (no `OpenAI` reference should remain in this file), and `client`/`model` are now imports from `./config`.

- [ ] **Step 5: Verify the legacy field is rejected**

Re-create the temporary `.env` from Task 1, then start the dev server:
```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
cat > .env <<'EOF'
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-test-dummy-key-for-config-load-check
AI_MODEL=gpt-4o-mini
EOF
npm run dev
```

In a second terminal, post a body that includes the legacy field:
```bash
curl -s -w "\n%{http_code}\n" -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"copy":"This is a test of the feedback endpoint with a long enough body to pass the length check.","apiKey":"should-be-rejected"}'
```

Expected: HTTP `400` and a body containing `This endpoint no longer accepts apiKey`. (The message format wraps multiple keys in a comma-separated list, so an `apiKey`-only request will name only `apiKey`.)

- [ ] **Step 6: Verify a copy-only body is accepted past validation**

In the same dev server, post a copy-only body:
```bash
curl -s -w "\n%{http_code}\n" -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"copy":"This is a test of the feedback endpoint with a long enough body to pass the length check."}'
```

Expected: HTTP `200` with a `clarity`/`cta`/`positioning` JSON body (if the test key happens to be valid) OR HTTP `502` with a provider error message (if the test key is fake, which is the case here). The important thing is that the response is **not** `400` with a body-validation message — that proves the legacy-field rejection is the only `400` path, and a copy-only body passes the body-validation phase.

Stop the dev server, then remove the temporary `.env`:
```bash
rm /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback/.env
```

- [ ] **Step 7: Commit**

```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
git add app/api/feedback/route.ts
git commit -m "Use server config in feedback route; reject legacy client fields"
```

---

## Task 3: Remove the client-side Settings panel and related state

**Files:**
- Modify: `app/page.tsx` (replace the whole file with the version below)

- [ ] **Step 1: Replace `app/page.tsx` with the stripped version**

Write `app/page.tsx` with this exact content (Settings panel, `Settings`/`DEFAULT_SETTINGS`, `useEffect`, `updateSetting`, `settings`/`settingsOpen` state, `hasKey`, the `apiKey` check in `getFeedback`, the BYOK footer, and the legacy body fields are all removed):

```tsx
"use client";

import { useState } from "react";

type SectionFeedback = {
  score: number;
  issues: string[];
  rewrite: string;
};

type FeedbackResponse = {
  clarity: SectionFeedback;
  cta: SectionFeedback;
  positioning: SectionFeedback;
  _meta?: {
    wasHtml: boolean;
    rawLength: number;
    cleanedLength: number;
    truncated: boolean;
  };
};

const EXAMPLE_COPY = `Headline: Stop wasting time on spreadsheets.

Subhead: The all-in-one workspace where modern teams plan, track, and ship — without the chaos.

Body:
ProjectFlow replaces your tangled mess of docs, tickets, and status meetings with one calm, focused workspace. Built for teams of 5 to 500. Trusted by 10,000+ companies.

Features:
- Real-time boards and docs in one place
- AI summaries of every meeting
- Automations that actually work
- Integrations with Slack, GitHub, Figma, and 50+ tools

CTA: Start free trial

Footer line: No credit card required.`;

const SECTIONS: Array<{ key: keyof FeedbackResponse; label: string; hint: string }> = [
  { key: "clarity", label: "Clarity", hint: "Is the value prop obvious in one read?" },
  { key: "cta", label: "CTA", hint: "Does the call-to-action pull its weight?" },
  { key: "positioning", label: "Positioning", hint: "Is the market and differentiation clear?" },
];

function scoreColor(score: number) {
  if (score >= 8) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 6) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function scoreRing(score: number) {
  if (score >= 8) return "ring-emerald-500/30 bg-emerald-500/5";
  if (score >= 6) return "ring-amber-500/30 bg-amber-500/5";
  return "ring-rose-500/30 bg-rose-500/5";
}

export default function Home() {
  const [copy, setCopy] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function getFeedback() {
    if (!copy.trim()) return;
    setError(null);
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copy }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        return;
      }
      setFeedback(data as FeedbackResponse);
    } catch (err) {
      setError((err as Error).message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  function loadExample() {
    setCopy(EXAMPLE_COPY);
    setFeedback(null);
    setError(null);
  }

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // clipboard may be blocked; non-fatal
    }
  }

  function formatFeedbackAsText(fb: FeedbackResponse): string {
    return SECTIONS.map(({ key, label }) => {
      const s = fb[key] as SectionFeedback;
      return [
        `## ${label} — ${s.score}/10`,
        "",
        "Issues:",
        ...s.issues.map((i) => `- ${i}`),
        "",
        "Suggested rewrite:",
        s.rewrite,
        "",
      ].join("\n");
    }).join("\n");
  }

  const canSubmit = copy.trim().length > 0 && !loading;

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Landing Page Feedback
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Paste your landing page copy. Get sharp AI feedback on clarity, CTA, and positioning.
          </p>
        </header>

        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="copy" className="text-sm font-medium">
              Your landing page copy
            </label>
            <button
              type="button"
              onClick={loadExample}
              className="text-xs font-medium text-zinc-500 underline-offset-4 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Load example
            </button>
          </div>
          <textarea
            id="copy"
            value={copy}
            onChange={(e) => setCopy(e.target.value)}
            placeholder="Paste your landing page copy — plain text or full HTML. If you paste HTML, scripts and tags are stripped automatically."
            rows={14}
            className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </section>

        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={getFeedback}
            disabled={!canSubmit}
            className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
          >
            {loading ? "Analyzing..." : "Get Feedback"}
          </button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {copy.length.toLocaleString()} chars
          </span>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </div>
        )}

        {feedback && (
          <section className="mt-8 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Feedback</h2>
              <div className="flex items-center gap-2">
                {feedback._meta?.wasHtml && (
                  <span
                    className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-normal text-sky-700 dark:text-sky-400"
                    title={`Extracted ${feedback._meta.cleanedLength.toLocaleString()} chars of text from ${feedback._meta.rawLength.toLocaleString()} chars of HTML${feedback._meta.truncated ? " (truncated to fit)" : ""}.`}
                  >
                    HTML detected
                    {feedback._meta.truncated ? " • truncated" : ""}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => copyToClipboard(formatFeedbackAsText(feedback), "all")}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {copiedKey === "all" ? "Copied!" : "Copy all"}
                </button>
              </div>
            </div>
            {SECTIONS.map(({ key, label, hint }) => {
              const s = feedback[key] as SectionFeedback;
              return (
                <article
                  key={key}
                  className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <header className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-semibold">{label}</h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
                    </div>
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold ring-2 ${scoreRing(s.score)} ${scoreColor(s.score)}`}
                    >
                      {s.score}
                    </div>
                  </header>

                  <div className="mb-3">
                    <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Issues
                    </h4>
                    <ul className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                      {s.issues.map((issue, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        Suggested rewrite
                      </h4>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(s.rewrite, key)}
                        className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                      >
                        {copiedKey === key ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                      {s.rewrite}
                    </p>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify lint and typecheck**

Run:
```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
npm run lint
npx tsc --noEmit
```

Expected: no errors. If `useEffect` is flagged as an unused import, you did not remove the import line — re-check the top of the file. The new top import line is `import { useState } from "react";`.

- [ ] **Step 3: Verify the page renders without the Settings panel and submits cleanly**

Re-create the temporary `.env` and start the dev server:
```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
cat > .env <<'EOF'
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-test-dummy-key-for-config-load-check
AI_MODEL=gpt-4o-mini
EOF
npm run dev
```

Open `http://localhost:3000` in a browser. Confirm:
- The page loads.
- There is **no** "Settings" collapsible section, no API base URL / API key / Model inputs, no "key set" / "no key" badge, no BYOK footer line.
- The "Get Feedback" button is disabled while the textarea is empty and enabled once text is entered.
- Clicking "Load example" fills the textarea with the example copy.
- Clicking "Get Feedback" sends a request and shows a result (real feedback if the env has a real key, an error from the provider otherwise — but the request should reach the route, not fail client-side).

Open DevTools → Application → Local Storage → `http://localhost:3000` and confirm there is **no** `lpf.settings` key written by the app.

Stop the dev server and remove the temporary `.env`:
```bash
rm /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback/.env
```

- [ ] **Step 4: Commit**

```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
git add app/page.tsx
git commit -m "Remove client-side settings panel; ship copy-only request body"
```

---

## Task 4: Add `.env.example` documenting the required env vars

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create the file**

Write `.env.example` at the repo root with this exact content:

```
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-replace-me
AI_MODEL=gpt-4o-mini
```

- [ ] **Step 2: Verify the file is not gitignored**

Run:
```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
git check-ignore -v .env.example
```

Expected output: (empty) — i.e. `git check-ignore` exits with a non-zero status and prints nothing. If it prints an ignore rule, `.env*` is matching `.env.example` and the file is being skipped; fix the `.gitignore` (e.g. with `!.env.example`) before continuing, or the file will not be committed.

- [ ] **Step 3: Commit**

```bash
cd /home/christopher/repos/ai-repos/redence-repo/landing-page-feedback
git add .env.example
git commit -m "Add .env.example documenting required AI env vars"
```

---

## Self-Review

Spec coverage check (each spec item → implementing task):
- New server-side config module: Task 1.
- Singleton `OpenAI` client: Task 1.
- Strip Settings panel and related client state: Task 3.
- Tighten request body to reject legacy fields: Task 2.
- Document required env vars in `.env.example`: Task 4.
- Fail fast at module load on missing env: Task 1, Step 2 verification.
- Remove env var names `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`: Task 1 uses these names; Tasks 2 and 3 inherit.
- `.env*` is already gitignored (verified in Task 4 Step 2).

Placeholder scan: no "TBD"/"TODO"/"implement later"/"add appropriate handling" present. Every code step shows the full code; every command shows the exact run line and expected output.

Type consistency: `client` and `model` are imported from `./config` in `route.ts` (Task 2 Step 1) and exported as `client` and `model` from `config.ts` (Task 1 Step 1). The `FORBIDDEN_KEYS` constant is locally scoped in the route handler. `Settings`/`DEFAULT_SETTINGS`/`useEffect`/`updateSetting`/`settings`/`settingsOpen`/`hasKey` are removed in Task 3 Step 1 and not referenced anywhere else in the plan.

Execution order: Task 1 → Task 2 → Task 3. Task 4 is independent. Each task's verification depends only on its own commit plus the previous tasks' commits, which matches the listed order.
