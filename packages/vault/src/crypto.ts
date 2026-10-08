// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import { createCipheriv, createDecipheriv, randomBytes, createHash, hkdfSync } from "node:crypto";
import argon2 from "argon2";

const ALGO = "aes-256-gcm";
const NONCE_LEN = 12;
const TAG_LEN = 16;

/** Fixed application salt. Deterministic so a KEK survives a process restart. */
const KEK_SALT = Buffer.from("wdc:agentvault:kek:v1", "utf8");

/**
 * Master passphrase -> KEK via Argon2id.
 *
 * v0.1.0 uses a fixed application salt so the KEK is reproducible across
 * restarts (no keyring file yet). The passphrase is the only secret; v0.2.0
 * moves to a per-installation random salt persisted in the DB.
 */
export async function deriveKek(passphrase: string, salt: Buffer = KEK_SALT): Promise<Buffer> {
  const raw = await argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
    raw: true,
  });
  return Buffer.from(raw);
}

export function generateDek(): Buffer { return randomBytes(32); }

export interface SealedBox {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

export function seal(key: Buffer, plaintext: Buffer, aad?: Buffer): SealedBox {
  if (key.length !== 32) throw new Error(`AES-256-GCM needs a 32-byte key, got ${key.length}`);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALGO, key, nonce);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

export function open(key: Buffer, box: SealedBox, aad?: Buffer): Buffer {
  const decipher = createDecipheriv(ALGO, key, box.nonce);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(box.tag);
  return Buffer.concat([decipher.update(box.ciphertext), decipher.final()]);
}

export function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hkdf(ikm: Buffer, info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, KEK_SALT, Buffer.from(info, "utf8"), length));
}

export { NONCE_LEN, TAG_LEN, ALGO };
