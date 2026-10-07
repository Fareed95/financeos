/** Signature is hex HMAC-SHA256 of `${timestamp}.${rawBody}`, sent as `sha256=<hex>`. Uses Web Crypto so the browser bundle never imports node:crypto. */

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function webhookSignature(secret: string, timestamp: string, body: string) {
  const payload = `${timestamp}.${body}`;
  const hex = await hmacHex(secret, payload);
  return { payload, header: `sha256=${hex}` };
}

export async function webhookSignatureMatches(secret: string, timestamp: string, body: string, header: string) {
  const expected = (await webhookSignature(secret, timestamp, body)).header;
  return safeEqual(expected, header);
}
