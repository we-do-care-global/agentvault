// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

import { newId, type DB } from "./db.js";
import type { ToolManifest, TrustLevel } from "@we-do-care/agentvault-shared";

export interface RegisteredTool {
  id: string;
  name: string;
  version: string;
  manifest: ToolManifest;
  trust_level: TrustLevel;
  publisher?: string;
}

interface ToolRow {
  id: string;
  name: string;
  version: string;
  manifest: string;
  trust_level: TrustLevel;
  publisher: string | null;
}

export class ToolRegistry {
  constructor(private db: DB, private tenant = "default") {}

  register(manifest: ToolManifest, trust: TrustLevel = "Medium", publisher?: string): RegisteredTool {
    const id = newId();
    this.db.prepare(`
      INSERT INTO tools (id, tenant_id, name, version, manifest, trust_level, publisher)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, name, version) DO UPDATE SET
        manifest=excluded.manifest,
        trust_level=excluded.trust_level,
        publisher=excluded.publisher
    `).run(
      id, this.tenant, manifest.name, manifest.version,
      JSON.stringify(manifest), trust, publisher ?? null,
    );
    return { id, name: manifest.name, version: manifest.version, manifest, trust_level: trust, publisher };
  }

  get(name: string, version?: string): RegisteredTool | null {
    const row = version
      ? this.db.prepare(`SELECT * FROM tools WHERE tenant_id=? AND name=? AND version=?`).get(this.tenant, name, version)
      : this.db.prepare(`SELECT * FROM tools WHERE tenant_id=? AND name=? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(this.tenant, name);
    if (!row) return null;
    return this.rowToTool(row as ToolRow);
  }

  list(): RegisteredTool[] {
    const rows = this.db.prepare(
      `SELECT * FROM tools WHERE tenant_id=? ORDER BY name, version`
    ).all(this.tenant) as ToolRow[];
    return rows.map(r => this.rowToTool(r));
  }

  remove(name: string, version: string): boolean {
    const r = this.db.prepare(
      `DELETE FROM tools WHERE tenant_id=? AND name=? AND version=?`
    ).run(this.tenant, name, version);
    return r.changes > 0;
  }

  private rowToTool(row: ToolRow): RegisteredTool {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      manifest: JSON.parse(row.manifest) as ToolManifest,
      trust_level: row.trust_level,
      publisher: row.publisher ?? undefined,
    };
  }
}
