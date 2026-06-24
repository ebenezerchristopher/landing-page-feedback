import { client, model } from "./config";

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

function looksLikeHtml(s: string): boolean {
  return /<[a-z!\/][^>]*>/i.test(s);
}

const BLOCK_TAGS =
  "p|div|section|article|header|footer|main|aside|nav|ul|ol|li|h[1-6]|br|tr|td|th|hr|blockquote|pre";

const INLINE_TAGS =
  "a|span|em|strong|b|i|u|small|sub|sup|mark|code|abbr|cite|q|font|button|label";

const VOID_TAGS = "script|style|noscript|head|title|meta|link|svg|iframe|template";

function stripHtml(input: string): string {
  let s = input;

  s = s.replace(new RegExp(`<(${VOID_TAGS})\\b[\\s\\S]*?<\\/\\1>`, "gi"), " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  s = s.replace(
    new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"),
    "\n",
  );
  s = s.replace(/<br\s*\/?>(?!\n)/gi, "\n");
  s = s.replace(
    new RegExp(`<\\/?(?:${INLINE_TAGS})\\b[^>]*>`, "gi"),
    " ",
  );

  s = s.replace(/<[^>]+>/g, "");

  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&copy;/gi, "©")
    .replace(/&reg;/gi, "®")
    .replace(/&trade;/gi, "™")
    .replace(/&hellip;/gi, "…")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&ldquo;/gi, "\u201C")
    .replace(/&rdquo;/gi, "\u201D")
    .replace(/&middot;/gi, "·")
    .replace(/&bull;/gi, "•")
    .replace(/&euro;/gi, "€")
    .replace(/&pound;/gi, "£")
    .replace(/&cent;/gi, "¢")
    .replace(/&times;/gi, "×")
    .replace(/&divide;/gi, "÷")
    .replace(/&#(\d+);/g, (_, d: string) =>
      String.fromCharCode(Number.parseInt(d, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCharCode(Number.parseInt(h, 16)),
    );

  const lines = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0);

  return lines.join("\n").trim();
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

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

  const rawLength = copy.length;
  const wasHtml = looksLikeHtml(copy);
  const cleaned = wasHtml ? stripHtml(copy) : copy.trim();
  const MAX_CLEANED = 30_000;
  const truncated = cleaned.length > MAX_CLEANED;
  const finalCopy = truncated ? cleaned.slice(0, MAX_CLEANED) : cleaned;

  if (finalCopy.length < 20) {
    return Response.json(
      {
        error:
          "No readable text found. If you pasted HTML, the page may be empty or built entirely from images/scripts.",
      },
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
        { role: "user", content: finalCopy },
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

    return Response.json({
      ...(parsed satisfies FeedbackResponse),
      _meta: {
        wasHtml,
        rawLength,
        cleanedLength: finalCopy.length,
        truncated,
      },
    });
  } catch (err) {
    const message = (err as Error).message || "Unknown error from API";
    return Response.json({ error: message }, { status: 502 });
  }
}
