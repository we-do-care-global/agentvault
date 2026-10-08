// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

import { createHash } from "node:crypto";
import type { DB } from "@we-do-care/agentvault-core";

const GENESIS = "0".repeat(64);

export interface AuditEntry {
  seq: number;
  tenant_id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  context?: unknown;
  prev_hash: string;
  hash: string;
}

interface AuditRow {
  seq: number;
  tenant_id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  context: string | null;
  prev_hash: string;
  hash: string;
}

/**
 * Append-only, hash-chained ledger. Each entry's hash covers the previous
 * hash, so any edit or deletion breaks every subsequent link and
 * `verifyChain()` reports the first bad sequence number.
 */
export class AuditLedger {
  constructor(private db: DB, private tenant = "default") {}

  /** Canonical serialisation used for hashing. Key order is fixed by construction. */
  private static hashPayload(e: {
    tenant_id: string; timestamp: string; actor: string;
    action: string; resource: string; context: unknown; prev_hash: string;
  }): string {
    return createHash("sha256").update(JSON.stringify(e)).digest("hex");
  }

  private head(): string {
    const row = this.db.prepare(
      `SELECT hash FROM audit_ledger WHERE tenant_id=? ORDER BY seq DESC LIMIT 1`
    ).get(this.tenant) as { hash: string } | undefined;
    return row?.hash ?? GENESIS;
  }

  append(actor: string, action: string, resource: string, context?: unknown): AuditEntry {
    const prev = this.head();
    const timestamp = new Date().toISOString();
    const hash = AuditLedger.hashPayload({
      tenant_id: this.tenant, timestamp, actor, action, resource, context, prev_hash: prev,
    });
    const r = this.db.prepare(`
      INSERT INTO audit_ledger (tenant_id, timestamp, actor, action, resource, context, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.tenant, timestamp, actor, action, resource,
      context === undefined ? null : JSON.stringify(context), prev, hash,
    );

    return { seq: Number(r.lastInsertRowid), tenant_id: this.tenant, timestamp, actor, action, resource, context, prev_hash: prev, hash };
  }

  verifyChain(): { ok: boolean; firstBadSeq?: number } {
    const rows = this.db.prepare(
      `SELECT * FROM audit_ledger WHERE tenant_id=? ORDER BY seq ASC`
    ).all(this.tenant) as AuditRow[];
    let prev = GENESIS;
    for (const row of rows) {
      const h = AuditLedger.hashPayload({
        tenant_id: row.tenant_id,
        timestamp: row.timestamp,
        actor: row.actor,
        action: row.action,
        resource: row.resource,
        context: row.context === null ? undefined : JSON.parse(row.context),
        prev_hash: prev,
      });
      if (h !== row.hash || row.prev_hash !== prev) return { ok: false, firstBadSeq: row.seq };
      prev = row.hash;
    }
    return { ok: true };
  }

  query(limit = 100, offset = 0): AuditEntry[] {
    const rows = this.db.prepare(
      `SELECT * FROM audit_ledger WHERE tenant_id=? ORDER BY seq DESC LIMIT ? OFFSET ?`
    ).all(this.tenant, limit, offset) as AuditRow[];
    return rows.map(r => ({
      seq: r.seq, tenant_id: r.tenant_id, timestamp: r.timestamp, actor: r.actor,
      action: r.action, resource: r.resource,
      context: r.context === null ? undefined : JSON.parse(r.context),
      prev_hash: r.prev_hash, hash: r.hash,
    }));
  }

  /** Test/ops helper: corrupts a row so chain verification can be proven. */
  tamper(seq: number, field: "actor" | "action" | "resource", value: string): boolean {
    const r = this.db.prepare(
      `UPDATE audit_ledger SET ${field}=? WHERE tenant_id=? AND seq=?`
    ).run(value, this.tenant, seq);
    return r.changes > 0;
  }
}

export { GENESIS };
