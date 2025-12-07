import { createHash } from "crypto";
import type { ByteLike } from "./types";

function toBuffer(data: ByteLike): Buffer {
  if (typeof data === "string") return Buffer.from(data);
  if (data instanceof Buffer) return data;
  return Buffer.from(data);
}

export function sha256(data: ByteLike): string {
  return createHash("sha256").update(toBuffer(data)).digest("hex");
}

export function sha256Bytes(data: ByteLike): Uint8Array {
  return createHash("sha256").update(toBuffer(data)).digest();
}
