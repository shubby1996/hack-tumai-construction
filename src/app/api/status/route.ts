// GET /api/status – tells the UI which AI engine and models are active (no secrets exposed).
import { connection } from "next/server";
import { aiConfig } from "@/lib/ai";

export async function GET() {
  await connection(); // evaluate at request time, not at build time
  const cfg = aiConfig();
  return Response.json({
    extraction: cfg.engine,
    model: cfg.textModel ?? null,
    vision: cfg.engine === "open" ? cfg.visionModel : null,
    host: cfg.baseUrl ? new URL(cfg.baseUrl).host : null,
  });
}
