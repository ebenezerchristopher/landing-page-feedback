import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SectionFeedback = {
  score: number;
  issues: string[];
  rewrite: string;
};

type FeedbackResponse = {
  clarity: SectionFeedback;
  cta: SectionFeedback;
  positioning: SectionFeedback;
};

const SYSTEM_PROMPT = `You are a sharp, opinionated landing-page reviewer. You give founders actionable feedback that improves conversion.

You will be given the text of a landing page (headline, subhead, body, CTAs, etc). You must evaluate it on exactly three dimensions: clarity, cta, positioning.

For EACH of the three dimensions, return JSON with this exact shape:
{
  "score": <integer 1-10>,
  "issues": [<string>, <string>, <string>],  // 2-3 specific, concrete problems. Quote the offending phrase when possible.
  "rewrite": <string>                        // A concrete, drop-in replacement (a rewritten headline, a rewritten CTA, or a rewritten positioning statement) that fixes the worst issue. Keep it tight and punchy.
}

Be specific and concrete. No generic advice like "make it clearer". Quote the actual words and explain why they fail, then show a fix.

Return ONLY a single JSON object with this exact top-level shape:
{
  "clarity": { "score": ..., "issues": [...], "rewrite": "..." },
  "cta":     { "score": ..., "issues": [...], "rewrite": "..." },
  "positioning": { "score": ..., "issues": [...], "rewrite": "..." }
}

No prose, no markdown, no code fences. JSON only.`;

function isFeedbackResponse(value: unknown): value is FeedbackResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  for (const key of ["clarity", "cta", "positioning"] as const) {
    const s = v[key] as Record<string, unknown> | undefined;
    if (!s) return false;
    if (typeof s.score !== "number" || s.score < 1 || s.score > 10) return false;
    if (!Array.isArray(s.issues)) return false;
    if (typeof s.rewrite !== "string") return false;
  }
  return true;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { copy, apiKey, baseUrl, model } = (body ?? {}) as {
    copy?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
    model?: unknown;
  };

  if (typeof copy !== "string" || copy.trim().length < 20) {
    return Response.json(
      { error: "Please paste at least a sentence of landing page copy." },
      { status: 400 },
    );
  }
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return Response.json(
      { error: "Missing API key. Add one in the settings panel." },
      { status: 400 },
    );
  }
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
    return Response.json(
      { error: "Base URL must start with http:// or https://" },
      { status: 400 },
    );
  }
  if (typeof model !== "string" || model.trim().length === 0) {
    return Response.json({ error: "Missing model name." }, { status: 400 });
  }

  let client: OpenAI;
  try {
    client = new OpenAI({ apiKey, baseURL: baseUrl.replace(/\/+$/, "") });
  } catch (err) {
    return Response.json(
      { error: `Could not create API client: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: copy },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (typeof raw !== "string") {
      return Response.json(
        { error: "Model returned no content." },
        { status: 502 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "Model returned invalid JSON. Try again." },
        { status: 502 },
      );
    }

    if (!isFeedbackResponse(parsed)) {
      return Response.json(
        { error: "Model returned JSON in the wrong shape. Try again." },
        { status: 502 },
      );
    }

    return Response.json(parsed satisfies FeedbackResponse);
  } catch (err) {
    const message = (err as Error).message || "Unknown error from API";
    return Response.json({ error: message }, { status: 502 });
  }
}
