import { getStore } from "@netlify/blobs";
import { json, requireUser } from "../lib/util.mjs";

const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 40;
const MAX_CHARS = 4000;
const MAX_BODY = 400000;

function cleanConversation(c) {
  if (!c || typeof c !== "object") return null;
  const id = typeof c.id === "string" && /^[\w-]{1,64}$/.test(c.id) ? c.id : null;
  if (!id) return null;
  const title = String(c.title || "New chat").slice(0, 60);
  const messages = (Array.isArray(c.messages) ? c.messages : [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (!messages.length) return null;
  return { id, title, messages, updated: Date.now() };
}

export default async (req) => {
  const user = await requireUser(req);
  if (!user) return json({ error: "Please log in." }, 401);

  const store = getStore({ name: "chats", consistency: "strong" });
  const data = (await store.get(user.uid, { type: "json" })) || { conversations: [] };
  let list = Array.isArray(data.conversations) ? data.conversations : [];

  if (req.method === "GET") {
    list.sort((a, b) => b.updated - a.updated);
    return json({ conversations: list });
  }

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "Conversation too large." }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    const conv = cleanConversation(body.conversation);
    if (!conv) return json({ error: "Invalid conversation." }, 400);

    list = list.filter((c) => c.id !== conv.id);
    list.unshift(conv);
    list.sort((a, b) => b.updated - a.updated);
    list = list.slice(0, MAX_CONVERSATIONS);
    await store.setJSON(user.uid, { conversations: list });
    return json({ ok: true, updated: conv.updated });
  }

  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return json({ error: "Missing id." }, 400);
    list = list.filter((c) => c.id !== id);
    await store.setJSON(user.uid, { conversations: list });
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/history",
  method: ["GET", "PUT", "DELETE"],
};
