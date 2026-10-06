import { createHmac, timingSafeEqual } from "node:crypto";

/** Signature is hex HMAC-SHA256 of `${timestamp}.${rawBody}`, sent as `sha256=<hex>`. */
export function webhookSignature(secret: string, timestamp: string, body: string) {
  const payload = `${timestamp}.${body}`;
  const hex = createHmac("sha256", secret).update(payload).digest("hex");
  return { payload, header: `sha256=${hex}` };
}

export function webhookSignatureMatches(secret: string, timestamp: string, body: string, header: string) {
  const expected = webhookSignature(secret, timestamp, body).header;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
