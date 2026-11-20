// POST /api/vision
// Describes one site photo with an open-source vision-language model (e.g. Qwen3-VL via Ollama).
// Returns { engine: "none" } when no open model is configured, so the UI simply skips the caption.

import { analysePhoto } from "@/lib/ai";

export async function POST(req: Request) {
  const { image, context } = (await req.json()) as { image?: string; context?: string };
  if (!image || !image.startsWith("data:image/")) return Response.json({ error: "image must be a data URL" }, { status: 400 });
  if (image.length > 6_000_000) return Response.json({ error: "image too large" }, { status: 413 });
  try {
    return Response.json(await analysePhoto(image, context));
  } catch (err) {
    console.error("vision failed", err);
    return Response.json({ caption: "", entryType: "note", findings: [], engine: "none", error: String(err).slice(0, 200) });
  }
}
