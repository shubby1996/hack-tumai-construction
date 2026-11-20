// Server-side AI helpers. Talks to any OpenAI-compatible chat endpoint, so small
// open-source models work out of the box:
//   - Ollama on your laptop   LLM_BASE_URL=http://localhost:11434/v1  (e.g. qwen3-vl:4b-instruct)
//   - Groq free tier          LLM_BASE_URL=https://api.groq.com/openai/v1
//   - Hugging Face, vLLM, LM Studio, OpenRouter … any /v1/chat/completions server
// Priority: open model (LLM_BASE_URL) → Claude (ANTHROPIC_API_KEY) → rule-based fallback.

export interface AiConfig {
  engine: "open" | "claude" | "rules";
  baseUrl?: string;
  apiKey?: string;
  textModel?: string;
  visionModel?: string;
}

export function aiConfig(): AiConfig {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/+$/, "");
  if (baseUrl) {
    const textModel = process.env.LLM_MODEL || "qwen3-vl:4b-instruct";
    return {
      engine: "open",
      baseUrl,
      apiKey: process.env.LLM_API_KEY || "none",
      textModel,
      visionModel: process.env.VLM_MODEL || textModel,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) return { engine: "claude", textModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5" };
  return { engine: "rules" };
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Part[];
}

export class ModelError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Groq's Qwen models think before answering unless told not to; thinking eats the free-tier token budget. */
function reasoningParams(cfg: AiConfig, model: string): Record<string, string> {
  const effort = process.env.LLM_REASONING_EFFORT ?? (cfg.baseUrl?.includes("api.groq.com") && /qwen/i.test(model) ? "none" : "");
  return effort ? { reasoning_effort: effort } : {};
}

/** One call to an OpenAI-compatible /chat/completions endpoint, asking for JSON. */
export async function openChatJson<T>(cfg: AiConfig, model: string, messages: ChatMessage[], timeoutMs = 60000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        // Keep under free-tier output limits (Groq: 1,000 output tokens/min on some models); override with LLM_MAX_TOKENS.
        max_tokens: Number(process.env.LLM_MAX_TOKENS) || 700,
        response_format: { type: "json_object" },
        ...reasoningParams(cfg, model),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      let msg = body.slice(0, 300);
      try {
        msg = JSON.parse(body)?.error?.message ?? msg;
      } catch {}
      throw new ModelError(res.status, `${model}: ${res.status} ${msg}`);
    }
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    return parseJsonLoose<T>(text);
  } finally {
    clearTimeout(timer);
  }
}

/** Try models in order; move on only when a model is missing or not allowed for this account. */
export async function openChatJsonWithFallback<T>(cfg: AiConfig, models: string[], messages: ChatMessage[]): Promise<{ out: T; model: string }> {
  const list = Array.from(new Set(models.filter(Boolean)));
  let lastErr: unknown;
  for (const model of list) {
    try {
      return { out: await openChatJson<T>(cfg, model, messages), model };
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ModelError && (err.status === 404 || err.status === 403))) throw err;
    }
  }
  throw lastErr;
}

/** Short, user-safe reason for showing in the UI when we fall back to rules. */
export function shortReason(err: unknown): string {
  if (err instanceof ModelError) {
    if (err.status === 404) return "model not available for this API key";
    if (err.status === 401) return "invalid API key";
    if (err.status === 429) return "rate limit reached, try again in a minute";
    return `model error ${err.status}`;
  }
  if (err instanceof Error && err.name === "AbortError") return "model timed out";
  return "model unreachable or returned invalid JSON";
}

/** Small models sometimes wrap JSON in prose, code fences or <think> blocks. */
export function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error(`model did not return JSON: ${cleaned.slice(0, 200)}`);
  }
}

// ------------------------------------------------------------------ photo understanding

export interface PhotoAnalysis {
  caption: string; // one factual sentence, what is visible
  entryType: string; // best-guess diary entry type
  findings: string[]; // visible issues (crack, wrong material, standing water …)
  textInImage?: string; // labels, delivery notes, signs
  engine: "open" | "none";
  model?: string;
}

const VISION_PROMPT = `You look at ONE photo from a German construction site and describe it for the site diary.
Return ONLY a JSON object with these keys:
- "caption": one short factual sentence of what is visible (English).
- "entryType": one of stoppage, delivery, defect, incident, progress, note.
- "findings": array of short strings for visible problems (e.g. "crack in concrete wall", "rebar diameter label 12 mm", "standing water in excavation"). Empty array if none.
- "textInImage": any readable text such as labels or delivery notes, or "" if none.
Rules: describe only what you can actually see. Do not guess causes, names, dates or amounts that are not visible.`;

export async function analysePhoto(dataUrl: string, context?: string): Promise<PhotoAnalysis> {
  const cfg = aiConfig();
  if (cfg.engine !== "open") return { caption: "", entryType: "note", findings: [], engine: "none" };
  const { out, model } = await openChatJsonWithFallback<Partial<PhotoAnalysis>>(cfg, [cfg.visionModel!], [
    { role: "system", content: VISION_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: context ? `Note from the site so far: "${context}". Describe the photo.` : "Describe the photo." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ]);
  return {
    caption: String(out.caption ?? "").trim(),
    entryType: String(out.entryType ?? "note"),
    findings: Array.isArray(out.findings) ? out.findings.map(String).slice(0, 6) : [],
    textInImage: out.textInImage ? String(out.textInImage) : "",
    engine: "open",
    model,
  };
}
