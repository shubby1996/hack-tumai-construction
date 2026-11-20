// GET /api/status – which AI engine and models are active (no secrets exposed).
// GET /api/status?check=1 – also asks the provider which models this API key can use.
import { connection } from "next/server";
import { aiConfig } from "@/lib/ai";

export async function GET(req: Request) {
  await connection(); // evaluate at request time, not at build time
  const cfg = aiConfig();
  const out: Record<string, unknown> = {
    extraction: cfg.engine,
    model: cfg.textModel ?? null,
    vision: cfg.engine === "open" ? cfg.visionModel : null,
    host: cfg.baseUrl ? new URL(cfg.baseUrl).host : null,
  };
  if (cfg.engine === "open" && new URL(req.url).searchParams.has("check")) {
    try {
      const res = await fetch(`${cfg.baseUrl}/models`, { headers: { authorization: `Bearer ${cfg.apiKey}` } });
      const data = res.ok ? await res.json() : null;
      const ids: string[] = (data?.data ?? []).map((m: { id: string }) => m.id).sort();
      out.check = res.ok
        ? { textModelAvailable: ids.includes(cfg.textModel!), visionModelAvailable: ids.includes(cfg.visionModel!), availableModels: ids }
        : { error: `provider answered ${res.status}` };
    } catch {
      out.check = { error: "provider unreachable" };
    }
  }
  return Response.json(out);
}
