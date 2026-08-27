// GET /api/warm -> { ready, status }
// Used ONLY by the UI during a cold-start wake-up.
// NOTE: do NOT poll this continuously — each /models GET resets the RunPod
// worker idle timer, which keeps the GPU warm and billing.
const DEFAULT_BASE = "https://api.runpod.ai/v2/c35fhlr8aefckk/openai/v1";

function envGet(name) {
  try {
    if (globalThis.Netlify?.env?.get) return globalThis.Netlify.env.get(name);
  } catch (_) {}
  try {
    if (globalThis.Deno?.env?.get) return globalThis.Deno.env.get(name);
  } catch (_) {}
  try {
    if (typeof process !== "undefined" && process.env) return process.env[name];
  } catch (_) {}
  return undefined;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default async (req) => {
  const base = envGet("RUNPOD_BASE_URL") || DEFAULT_BASE;
  const key = envGet("RUNPOD_API_KEY");
  const accessCode = envGet("CHAT_ACCESS_CODE");

  if (!key) return json({ ready: false, status: "no-key" });
  if (accessCode && req.headers.get("x-access-code") !== accessCode) {
    return json({ ready: false, status: "unauthorized" }, 401);
  }

  try {
    const r = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(25000),
    });
    return json({ ready: r.ok, status: r.status });
  } catch (e) {
    const status = e && e.name === "TimeoutError" ? "cold" : "error";
    return json({ ready: false, status });
  }
};
