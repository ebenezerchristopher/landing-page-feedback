# Server-side AI configuration

**Status:** Design, awaiting user review
**Date:** 2026-06-24

## Goal

Move the AI provider configuration (base URL, API key, model) from a per-user
client-side settings panel into server-side environment variables. End users
can no longer view, set, or override these values; the app uses one
configuration for all requests.

## Motivation

The current design is "BYOK" (bring your own key): the client stores the key in
`localStorage` and posts it to `/api/feedback` with every request
(state and settings panel in `app/page.tsx:23-252`; body assembly and
client construction in `app/api/feedback/route.ts:131-179`). That puts the
burden of acquiring a key on every user and exposes the key to the
client. The operator of this app already has a provider account; the
simpler model is to configure the server once and have all requests share it.

## Scope

In scope:

- New server-side config module that reads and validates env vars at module
  load.
- Server-side singleton `OpenAI` client.
- Stripping the Settings panel and related client state from the homepage.
- Tightening the request body contract to reject legacy fields.
- Documenting the required env vars in `.env.example`.

Out of scope:

- Adding a test framework or new automated tests.
- Changing the provider, model, or prompt.
- Adding any `NEXT_PUBLIC_*` exposure of provider config.
- Rate limiting, auth, or any access control on `/api/feedback`.

## File changes

### New: `app/api/feedback/config.ts`

Responsibilities:

- Read `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` from `process.env` at module
  load.
- Validate: all three are non-empty strings; `AI_BASE_URL` matches
  `^https?://`.
- If any check fails, throw a descriptive `Error`. Do not swallow it.
- Strip trailing slashes from `AI_BASE_URL` to preserve the existing
  normalization in `route.ts:179`.
- Construct a single `OpenAI` client with `{ apiKey, baseURL: baseUrl }`.
- Export `client`, `model`, and `baseUrl`.

Module load throws, so importing this file (transitively, via `route.ts`)
fails. Next.js will surface this as a 500 in production and as a dev overlay
error in development. This is the intended "fail fast" behavior.

### Edit: `app/api/feedback/route.ts`

- Import the `client` and `model` from the new config module.
- Remove the `apiKey`, `baseUrl`, and `model` fields from the request body
  type and validation.
- After parsing the body, reject the request with 400 if the parsed object
  has any of the keys `apiKey`, `baseUrl`, or `model` (any value, including
  `null` or empty string). Rejection message:
  `"This endpoint no longer accepts apiKey/baseUrl/model. Configure the server with AI_BASE_URL, AI_API_KEY, and AI_MODEL."`
- Remove the per-request `new OpenAI(...)` construction and the surrounding
  `try/catch` for client creation.
- Keep the `copy` validation, HTML stripping, truncation, prompt, response
  shape check, and the `_meta` payload unchanged.

### Edit: `app/page.tsx`

Remove:

- The `Settings` type and `DEFAULT_SETTINGS` constant.
- The `useEffect` that reads `lpf.settings` from `localStorage`.
- The `updateSetting` helper and its `localStorage.setItem` call.
- The `settings` and `settingsOpen` state variables (used only by the
  Settings panel).
- The Settings `<section>` block (the collapsible panel and its three
  inputs).
- The `hasKey` derived value and the `canSubmit` key check; the submit
  button is enabled whenever `copy.trim().length > 0` and not loading.
- The "Add your API key in Settings first." branch in `getFeedback`.
- The "key set" / "no key" badges in the Settings header.
- The `BYOK — your key never leaves the page...` footer line.

Keep everything else: copy textarea, "Load example" button, submit button,
loading state, error display, feedback rendering, copy-to-clipboard, the
`copiedKey` state (used by the feedback copy buttons, not the Settings
panel), and the example copy constant.

### New: `.env.example`

Document the three required variables with placeholder values:

```
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-replace-me
AI_MODEL=gpt-4o-mini
```

`.env*` is already in `.gitignore` (line 34), so this file is safe to
commit as documentation only.

## Request body contract

`POST /api/feedback`:

- **Required:** `copy: string` (≥20 chars after normalization, same as
  today).
- **Forbidden:** `apiKey`, `baseUrl`, `model` (any presence → 400).
- **Unchanged:** HTML auto-detection, stripping, 30,000-char truncation,
  system prompt, response shape (clarity/cta/positioning scores + `_meta`).

## Error handling

| Condition                                   | Response                                                     |
| ------------------------------------------- | ------------------------------------------------------------ |
| Missing/invalid env at module load          | Server fails to start the route; Next.js 500 in prod, dev overlay in dev. No graceful fallback. |
| `copy` missing or <20 chars                 | 400 `"Please paste at least a sentence of landing page copy."` (unchanged) |
| Request body contains `apiKey`/`baseUrl`/`model` | 400 with the rejection message above.                  |
| OpenAI API error                            | 502 with provider's error message (unchanged)                |
| Model returns non-JSON or wrong shape       | 502 (unchanged)                                              |

## Verification

Manual checks, in order:

1. **No env configured.** Start the dev server with no `.env`. Confirm the
   server logs the module-load error and `/api/feedback` is not usable
   (500 / dev overlay).
2. **Valid env configured.** Add `.env` with the three vars, restart.
   Load the homepage, paste the example copy, click "Get Feedback".
   Confirm the Settings panel is gone, no `lpf.settings` entry is created
   in `localStorage`, and feedback renders.
3. **Legacy body rejected.** `curl -X POST` the route with a body that
   includes `apiKey`. Confirm a 400 with the rejection message.
4. **Lint and typecheck.** `npm run lint` (the project's existing check).

## Rollback

Reverting the four file changes (the new `config.ts`, the route, the page,
and removing `.env.example`) returns the app to its BYOK behavior. The
`.env*` entries in `.gitignore` already cover cleanup of any added `.env`.
