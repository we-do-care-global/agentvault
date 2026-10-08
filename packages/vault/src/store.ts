// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

import { openDb, newId, type DB } from "@we-do-care/agentvault-core";
import { Errors } from "@we-do-care/agentvault-shared";
import { deriveKek, generateDek, seal, open } from "./crypto.js";

export interface SecretMeta {
  id: string;
  namespace: string;
  key: string;
  key_version: number;
  scope?: string;
  expires_at?: string;
}

interface SecretRow {
  id: string;
  namespace: string;
  key: string;
  key_version: number;
  algorithm: string;
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  aad: Buffer | null;
  wrapped_dek: Buffer;
  dek_nonce: Buffer;
  dek_tag: Buffer;
  scope: string | null;
  ttl_seconds: number | null;
  expires_at: string | null;
}

/**
 * Envelope-encrypted secret store: every value gets a fresh random DEK
 * (AES-256-GCM), and the DEK itself is sealed under a KEK derived from the
 * master passphrase with Argon2id. AAD binds tenant|namespace|key|version,
 * so a row cannot be replayed under a different name.
 */
export class SecretVault {
  private kek: Buffer | null = null;
  private closed = false;

  constructor(
    private db: DB,
    private tenant: string,
    private masterPassphrase: string,
  ) {
    if (!masterPassphrase) throw Errors.validation("masterPassphrase is required");
  }

  private async kekFor(): Promise<Buffer> {
    if (this.kek) return this.kek;
    this.kek = await deriveKek(this.masterPassphrase);
    return this.kek;
  }

  /** Wipes the cached KEK. Safe to call more than once. */
  lock(): void {
    this.kek?.fill(0);
    this.kek = null;
    this.closed = true;
  }

  private latestRow(namespace: string, key: string): SecretRow | undefined {
    return this.db.prepare(
      `SELECT * FROM secrets WHERE tenant_id=? AND namespace=? AND key=?
       ORDER BY key_version DESC LIMIT 1`
    ).get(this.tenant, namespace, key) as SecretRow | undefined;
  }

  private writeRow(version: number, namespace: string, key: string, value: string, opts?: {
    scope?: string; ttlSeconds?: number;
  }): SecretMeta {
    const id = newId();
    const expiresAt = opts?.ttlSeconds
      ? new Date(Date.now() + opts.ttlSeconds * 1000).toISOString()
      : null;

    // The KEK is already derived (callers await kekFor() first), so the
    // envelope can be built synchronously.
    const kekReady = this.kek;
    if (!kekReady) throw Errors.internal("vault not initialised");
    const dek = generateDek();
    const aad = Buffer.from(`${this.tenant}|${namespace}|${key}|${version}`, "utf8");
    const valueBox = seal(dek, Buffer.from(value, "utf8"), aad);
    const dekBox = seal(kekReady, dek, aad);
    dek.fill(0);

    this.db.prepare(`
      INSERT INTO secrets (id, tenant_id, namespace, key, key_version, algorithm,
        ciphertext, nonce, tag, aad, wrapped_dek, dek_nonce, dek_tag,
        scope, ttl_seconds, expires_at)
      VALUES (?, ?, ?, ?, ?, 'AES-256-GCM', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, namespace, key, key_version) DO UPDATE SET
        ciphertext=excluded.ciphertext, nonce=excluded.nonce, tag=excluded.tag,
        aad=excluded.aad, wrapped_dek=excluded.wrapped_dek,
        dek_nonce=excluded.dek_nonce, dek_tag=excluded.dek_tag,
        scope=excluded.scope, ttl_seconds=excluded.ttl_seconds, expires_at=excluded.expires_at
    `).run(
      id, this.tenant, namespace, key, version,
      valueBox.ciphertext, valueBox.nonce, valueBox.tag, aad,
      dekBox.ciphertext, dekBox.nonce, dekBox.tag,
      opts?.scope ?? null, opts?.ttlSeconds ?? null, expiresAt,
    );

    return { id, namespace, key, key_version: version, scope: opts?.scope, expires_at: expiresAt ?? undefined };
  }

  async put(namespace: string, key: string, value: string, opts?: {
    scope?: string; ttlSeconds?: number;
  }): Promise<SecretMeta> {
    await this.kekFor();
    const current = this.latestRow(namespace, key);
    // Overwrite in place at the current version; a fresh key starts at 1.
    const version = current?.key_version ?? 1;
    return this.writeRow(version, namespace, key, value, opts);
  }

  /**
   * Zero-downtime rotation to the next `key_version`.
   * With no `newValue` the current plaintext is re-sealed under a brand-new DEK,
   * so key material changes without a value change (a true re-wrap). With
   * `newValue` the new value lands at the next version and the prior version
   * row is retained for rollback.
   */
  async rotate(namespace: string, key: string, newValue?: string): Promise<SecretMeta> {
    const current = this.latestRow(namespace, key);
    if (!current) throw Errors.validation(`secret not found: vault://${namespace}/${key}`);

    const value = newValue ?? await this.get(namespace, key);
    const ttlSeconds = current.expires_at
      ? Math.max(1, Math.round((new Date(current.expires_at).getTime() - Date.now()) / 1000))
      : undefined;

    await this.kekFor();
    return this.writeRow(current.key_version + 1, namespace, key, value, {
      scope: current.scope ?? undefined,
      ttlSeconds,
    });
  }

  async get(namespace: string, key: string): Promise<string> {
    const row = this.latestRow(namespace, key);
    if (!row) throw Errors.validation(`secret not found: vault://${namespace}/${key}`);
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      throw Errors.policy(`secret expired: vault://${namespace}/${key}`);
    }
    const kek = await this.kekFor();
    const dek = open(kek, {
      ciphertext: row.wrapped_dek, nonce: row.dek_nonce, tag: row.dek_tag,
    }, row.aad ?? undefined);
    try {
      return open(dek, {
        ciphertext: row.ciphertext, nonce: row.nonce, tag: row.tag,
      }, row.aad ?? undefined).toString("utf8");
    } finally {
      dek.fill(0); // zeroize the unwrapped DEK
    }
  }

  list(): SecretMeta[] {
    const rows = this.db.prepare(
      `SELECT s.id, s.namespace, s.key, s.key_version, s.scope, s.expires_at
       FROM secrets s
       JOIN (SELECT namespace, key, MAX(key_version) AS v
             FROM secrets WHERE tenant_id=? GROUP BY namespace, key) m
         ON m.namespace = s.namespace AND m.key = s.key AND m.v = s.key_version
       WHERE s.tenant_id=?
       ORDER BY s.namespace, s.key`
    ).all(this.tenant, this.tenant) as SecretMeta[];
    return rows.map(r => ({ ...r, scope: r.scope ?? undefined, expires_at: r.expires_at ?? undefined }));
  }

  /** Destroys every version of a secret. Returns true if anything was deleted. */
  revoke(namespace: string, key: string): boolean {
    const r = this.db.prepare(
      `DELETE FROM secrets WHERE tenant_id=? AND namespace=? AND key=?`
    ).run(this.tenant, namespace, key);
    return r.changes > 0;
  }
}

export function createVault(masterPassphrase: string, dbPath?: string): SecretVault {
  const db = openDb(dbPath);
  return new SecretVault(db, "default", masterPassphrase);
}
