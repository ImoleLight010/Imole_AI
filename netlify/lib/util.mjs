import { webcrypto, randomBytes, timingSafeEqual } from "node:crypto";

const subtle = webcrypto.subtle;
const enc = new TextEncoder();

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const SESSION_DAYS = 30;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET_MISSING");
  return s;
}

export const hasSecret = () => {
  const s = process.env.AUTH_SECRET;
  return Boolean(s && s.length >= 16);
};

async function hmac(data) {
  const key = await subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return Buffer.from(await subtle.sign("HMAC", key, enc.encode(data)));
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = (await hmac(body)).toString("base64url");
  return `${body}.${sig}`;
}

export async function verifyToken(token) {
  if (typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = (await hmac(body)).toString("base64url");
  if (!safeEqual(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || !payload.uid || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export async function requireUser(req) {
  try {
    const h = req.headers.get("authorization") || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    return await verifyToken(token);
  } catch {
    return null;
  }
}

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, "base64") : randomBytes(16);
  const key = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return {
    salt: salt.toString("base64"),
    hash: Buffer.from(bits).toString("base64"),
  };
}

export const sameSecret = safeEqual;
