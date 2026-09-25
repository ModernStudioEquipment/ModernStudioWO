// A link you can put in an email that nobody else can forge.
//
// The "mark it fixed" link goes out in the notification mail and has to work
// from a phone, in an inbox, with no login. So the id carries its own proof: an
// HMAC over the id, made with a key that only the server has. Change the id and
// the signature stops matching.
//
// The key is SUPABASE_SECRET_KEY, with a purpose string mixed in so a signature
// minted here can't be replayed anywhere else that might sign with the same key.

import crypto from "node:crypto";

const PURPOSE = "feedback-fix:v1";

export function signId(id, key) {
  return crypto.createHmac("sha256", String(key || "")).update(`${PURPOSE}:${id}`).digest("hex").slice(0, 32);
}

export function verifyId(id, sig, key) {
  if (!id || !sig || !key) return false;
  const mine = Buffer.from(signId(id, key), "utf8");
  const given = Buffer.from(String(sig), "utf8");
  return mine.length === given.length && crypto.timingSafeEqual(mine, given);
}
