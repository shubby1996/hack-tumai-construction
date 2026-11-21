// POST /api/summary – a short "today so far" summary for the site manager.
// The client sends the facts of the day as plain text; the model only rephrases them.

import { aiConfig, openChatJsonWithFallback, shortReason } from "@/lib/ai";

const PROMPT = `You write the "today so far" summary for a German construction site manager.
Return ONLY JSON: {"summary": string}. The summary is 3 to 5 short English bullet lines, each starting with "• ".
Order: what needs his decision, problems and delays with consequences, what went well. Use only the facts given. No greetings.`;

export async function POST(req: Request) {
  const { facts } = (await req.json()) as { facts?: string };
  const text = (facts ?? "").trim().slice(0, 5000);
  if (!text) return Response.json({ error: "no facts" }, { status: 400 });
  const cfg = aiConfig();
  if (cfg.engine !== "open") return Response.json({ engine: "rules" });
  try {
    const { out, model } = await openChatJsonWithFallback<{ summary?: string }>(cfg, [cfg.textModel!, cfg.visionModel!], [
      { role: "system", content: PROMPT },
      { role: "user", content: text },
    ]);
    return Response.json({ engine: "open", model, summary: String(out.summary ?? "").trim() });
  } catch (err) {
    return Response.json({ engine: "rules", fallbackReason: shortReason(err) });
  }
}
