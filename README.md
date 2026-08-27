# qwen-chat

Chatbot UI for `sakamakismile/Huihui-Qwen3.8-27B-abliterated-NVFP4` hosted on
RunPod serverless, deployed free on Netlify via GitHub.

- Static `index.html` — dark chat UI, streaming (SSE), markdown-lite, history in
  localStorage, stop button, system prompt / temp / max-token settings.
- Two Netlify **edge functions**:
  - `proxy` (`/api/chat`) — injects `RUNPOD_API_KEY` server-side and streams the
    RunPod OpenAI-compatible endpoint to the browser. Edge functions return
    headers immediately, so multi-minute RunPod cold boots don't hit Netlify's
    60s synchronous-function limit.
  - `warm` (`/api/warm`) — one-shot readiness check used on page load. Do not
    poll it: each `/models` GET resets the RunPod worker idle timer and keeps
    the GPU billing.

## Deploy

1. Push this repo to GitHub.
2. Netlify → Add new site → Import from Git → pick the repo. Build settings
   auto-apply from `netlify.toml` (publish `.`, no build command).
3. Site configuration → Environment variables:
   - `RUNPOD_API_KEY` (required)
   - `RUNPOD_BASE_URL` (optional; default is the live qwen27b endpoint)
   - `CHAT_ACCESS_CODE` (optional; if set, enter it in the UI's ⚙ settings)
4. Redeploy so the new env vars take effect.

## Changing the endpoint

After a redeploy of the RunPod serverless endpoint (endpoint id changes), set
`RUNPOD_BASE_URL` to `https://api.runpod.ai/v2/<NEW_ID>/openai/v1` in Netlify
env vars — or update `DEFAULT_BASE` in both edge functions and push.

## Notes

- **Cold starts**: RunPod's OpenAI streaming route hangs for a fixed ~300s and
  returns an empty stream if the request lands while the worker is booting.
  The proxy therefore pre-flights `/models` (20s budget) and returns
  `503 {cold:true}`; the UI shows a wake banner and auto-retries every 15s
  (~5 min of patience) before streaming. Warm streaming is unaffected.
- `max_tokens` is capped at 8000 (well below the 64K context) — near-context
  max_tokens makes vLLM return an empty stream.
- RunPod serverless scales to zero at rest: idle = $0. First request after idle
  pays a 2–7 min boot; the UI handles the wait automatically.
