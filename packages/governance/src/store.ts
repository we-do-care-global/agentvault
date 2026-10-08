// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import { newId, type DB } from "@we-do-care/agentvault-core";
import { Errors, type PolicyRule } from "@we-do-care/agentvault-shared";

export class PolicyStore {
  constructor(private db: DB, private tenant = "default") {}

  put(rule: PolicyRule): PolicyRule {
    if (!rule?.id || !rule.action) throw Errors.validation("policy requires id and action");
    const name = rule.name ?? rule.id;
    this.db.prepare(`
      INSERT INTO policies (id, tenant_id, name, rule, priority, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(tenant_id, name) DO UPDATE SET
        id=excluded.id, rule=excluded.rule, priority=excluded.priority
    `).run(rule.id, this.tenant, name, JSON.stringify(rule), rule.priority ?? 100);
    return rule;
  }

  list(): PolicyRule[] {
    const rows = this.db.prepare(
      `SELECT rule FROM policies WHERE tenant_id=? AND enabled=1 ORDER BY priority DESC`
    ).all(this.tenant) as Array<{ rule: string }>;
    return rows.map(r => JSON.parse(r.rule) as PolicyRule);
  }

  remove(name: string): boolean {
    return this.db.prepare(
      `DELETE FROM policies WHERE tenant_id=? AND name=?`
    ).run(this.tenant, name).changes > 0;
  }
}
