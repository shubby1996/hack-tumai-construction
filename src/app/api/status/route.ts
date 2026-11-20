// GET /api/status – tells the UI which AI engine is active (no secrets exposed).
import { connection } from "next/server";

export async function GET() {
  await connection(); // evaluate at request time, not at build time
  return Response.json({
    extraction: process.env.ANTHROPIC_API_KEY ? "claude" : "rules",
    model: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5" : null,
  });
}
