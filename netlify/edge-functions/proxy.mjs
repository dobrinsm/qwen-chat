// Edge proxy: browser -> this function -> RunPod OpenAI-compatible endpoint.
// Returns SSE headers immediately, then pipes upstream bytes through as they
// arrive.
//
// IMPORTANT: RunPod's OpenAI streaming route HANGS until a fixed ~300s cap
// when the request lands while the worker is cold-booting (observed twice:
// exactly 300.1s, empty stream, warm streaming works fine). So we pre-flight
// /models with a short timeout and refuse (503 {cold:true}) if the worker
// isn't ready. The UI runs the wake loop and resends.
//
// Env vars (Netlify UI -> Site configuration -> Environment variables):
//   RUNPOD_API_KEY    (required) RunPod API key, sent as Bearer to the endpoint
//   RUNPOD_BASE_URL   (optional) defaults to the live qwen27b serverless endpoint
//   CHAT_ACCESS_CODE  (optional) if set, UI must send header x-access-code

const DEFAULT_BASE = "https://api.runpod.ai/v2/c35fhlr8aefckk/openai/v1";
const MODEL = "sakamakismile/Huihui-Qwen3.8-27B-abliterated-NVFP4";
const UPSTREAM_TIMEOUT_MS = 600000; // 10 min hard cap for a warm streaming call
const WARM_CHECK_TIMEOUT_MS = 20000; // warm /models can take ~7s; cold hangs 300s — 20s splits them
const MAX_TOKENS_CAP = 32000; // proven safe ceiling on 64K ctx; >= ~60K -> empty stream

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

async function workerReady(base, key) {
  try {
    const r = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(WARM_CHECK_TIMEOUT_MS),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const base = envGet("RUNPOD_BASE_URL") || DEFAULT_BASE;
  const key = envGet("RUNPOD_API_KEY");
  const accessCode = envGet("CHAT_ACCESS_CODE");

  if (!key) return json({ error: "Server: RUNPOD_API_KEY env var is not set" }, 500);
  if (accessCode && req.headers.get("x-access-code") !== accessCode) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload;
  try {
    payload = await req.json();
  } catch (_) {
    return json({ error: "invalid JSON body" }, 400);
  }

  // Cold gate: never send a streaming request into a cold boot.
  if (!(await workerReady(base, key))) {
    return json({ error: "worker cold — waking GPU, retry in a moment", cold: true }, 503);
  }

  payload.model = payload.model || MODEL;
  payload.stream = true;
  const mt = Number(payload.max_tokens) || 4000;
  payload.max_tokens = Math.min(Math.max(mt, 256), MAX_TOKENS_CAP);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch (_) {}
      };
      try {
        const up = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });

        if (!up.ok || !up.body) {
          let detail = "";
          try {
            detail = (await up.text()).slice(0, 400);
          } catch (_) {}
          send({ error: `RunPod ${up.status}: ${detail || up.statusText}` });
        } else {
          const reader = up.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value); // raw SSE passthrough
          }
        }
      } catch (e) {
        const msg = e && e.name === "TimeoutError"
          ? "upstream timeout — worker may have wedged; try again"
          : `proxy error: ${(e && e.message) || e}`;
        send({ error: msg });
      }
      send({ control: "done" });
      try {
        controller.close();
      } catch (_) {}
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
};
