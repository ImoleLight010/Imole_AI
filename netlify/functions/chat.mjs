const MODELS = [
  process.env.IMOLE_MODEL,
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
].filter(Boolean);

const MAX_MESSAGES = 12;
const MAX_CHARS = 2000;
const MAX_REPLY_TOKENS = 500;

const SYSTEM_PROMPT = `You are IMOLE AI, a friendly, clear and helpful assistant.
Give accurate, practical answers. Keep replies concise unless the user asks for detail.
Use short paragraphs. Put code in fenced code blocks. If you are unsure, say so.`;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "Please send a message." }, 400);
  }

  const base = process.env.OPENAI_BASE_URL;
  const key = process.env.OPENAI_API_KEY;
  if (!base || !key) {
    return json(
      { error: "AI Gateway is not active yet. Enable AI features and make sure the site has a production deploy." },
      503
    );
  }

  const root = base.replace(/\/+$/, "");
  const url = root.endsWith("/v1")
    ? `${root}/chat/completions`
    : `${root}/v1/chat/completions`;

  let upstream = null;
  let lastStatus = 0;
  let lastDetail = "";

  for (const model of MODELS) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          max_completion_tokens: MAX_REPLY_TOKENS,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        }),
      });
    } catch {
      return json({ error: "Could not reach the AI service. Try again." }, 502);
    }

    if (res.ok) {
      upstream = res;
      break;
    }

    lastStatus = res.status;
    try {
      lastDetail = (await res.text()).slice(0, 300);
    } catch {}
    console.error("AI Gateway error", model, lastStatus, lastDetail);

    // Only try the next model if this model was rejected or not found.
    if (lastStatus !== 400 && lastStatus !== 404) break;
  }

  if (!upstream) {
    if (lastStatus === 429) {
      return json({ error: "IMOLE AI is busy right now. Please wait a moment and try again." }, 429);
    }
    return json({ error: `AI error ${lastStatus}: ${lastDetail.slice(0, 150)}` }, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
};

export const config = {
  path: "/api/chat",
  method: "POST",
  rateLimit: {
    windowLimit: 15,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
