"use client";

import { useEffect, useState } from "react";

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

type Settings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copy, setCopy] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("lpf.settings");
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch {
      // ignore corrupt storage
    }
  }, []);

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem("lpf.settings", JSON.stringify(next));
      } catch {
        // storage may be unavailable; non-fatal
      }
      return next;
    });
  }

  async function getFeedback() {
    if (!copy.trim()) return;
    if (!settings.apiKey.trim()) {
      setError("Add your API key in Settings first.");
      setSettingsOpen(true);
      return;
    }
    setError(null);
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          copy,
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
        }),
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

  const hasKey = settings.apiKey.trim().length > 0;
  const canSubmit = copy.trim().length > 0 && hasKey && !loading;

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

        <section className="mb-6 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium sm:px-5"
          >
            <span className="flex items-center gap-2">
              <span>Settings</span>
              {hasKey ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-normal text-emerald-700 dark:text-emerald-400">
                  key set
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-normal text-amber-700 dark:text-amber-400">
                  no key
                </span>
              )}
            </span>
            <span className="text-zinc-400">{settingsOpen ? "−" : "+"}</span>
          </button>
          {settingsOpen && (
            <div className="border-t border-zinc-200 px-4 py-4 sm:px-5 dark:border-zinc-800">
              <div className="grid gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    API base URL
                  </span>
                  <input
                    type="url"
                    value={settings.baseUrl}
                    onChange={(e) => updateSetting("baseUrl", e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-mono text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    API key
                  </span>
                  <input
                    type="password"
                    value={settings.apiKey}
                    onChange={(e) => updateSetting("apiKey", e.target.value)}
                    placeholder="sk-..."
                    autoComplete="off"
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-mono text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Model
                  </span>
                  <input
                    type="text"
                    value={settings.model}
                    onChange={(e) => updateSetting("model", e.target.value)}
                    placeholder="gpt-4o-mini"
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-mono text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Works with any OpenAI-compatible API (OpenAI, OpenRouter, Groq, Together, local Ollama, etc).
                  Your key is stored only in this browser and sent once per request.
                </p>
              </div>
            </div>
          )}
        </section>

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

        <footer className="mt-12 text-center text-xs text-zinc-400">
          BYOK — your key never leaves the page except for the one request to your provider.
        </footer>
      </div>
    </div>
  );
}
