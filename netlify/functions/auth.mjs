import { getStore } from "@netlify/blobs";
import { randomUUID, createHash } from "node:crypto";
import {
  json,
  hasSecret,
  signToken,
  hashPassword,
  sameSecret,
  SESSION_DAYS,
} from "../lib/util.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!hasSecret()) {
    return json(
      { error: "Server setup incomplete: add AUTH_SECRET in Netlify environment variables, then redeploy." },
      500
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const action = body.action;
  const email = String(body.email || "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (action !== "signup" && action !== "login") {
    return json({ error: "Invalid request." }, 400);
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: "Please enter a valid email address." }, 400);
  }
  if (password.length < 8 || password.length > 128) {
    return json({ error: "Password must be 8 to 128 characters." }, 400);
  }

  const users = getStore({ name: "users", consistency: "strong" });
  const key = createHash("sha256").update(email).digest("hex");
  const existing = await users.get(key, { type: "json" });

  let user;

  if (action === "signup") {
    if (existing) {
      return json({ error: "An account with this email already exists. Please log in." }, 409);
    }
    const { salt, hash } = await hashPassword(password);
    user = { id: randomUUID(), email, salt, hash, created: Date.now() };
    await users.setJSON(key, user);
  } else {
    if (!existing) {
      await hashPassword(password);
      return json({ error: "Wrong email or password." }, 401);
    }
    const { hash } = await hashPassword(password, existing.salt);
    if (!sameSecret(hash, existing.hash)) {
      return json({ error: "Wrong email or password." }, 401);
    }
    user = existing;
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const token = await signToken({ uid: user.id, email: user.email, exp });
  return json({ token, email: user.email });
};

export const config = {
  path: "/api/auth",
  method: "POST",
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
