// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import { newId, type DB } from "@we-do-care/agentvault-core";

export interface ToolCallSpan {
  tool: string;
  version: string;
  agentUri: string;
  provider: string;
  latencyMs: number;
  status: "ok" | "error" | "denied";
  errorClass?: string;
  costUsd?: number;
}

export type SpanListener = (span: ToolCallSpan) => void;

interface CallRow {
  tool_name: string; tool_version: string; agent_uri: string; provider: string;
  latency_ms: number; status: "ok" | "error" | "denied";
  error_class: string | null; cost_usd: number | null;
}

/**
 * Durable call log plus an in-process pub/sub used to drive the SSE stream.
 * Latency, cost and error class are captured per tool call.
 */
export class Telemetry {
  private listeners = new Set<SpanListener>();

  constructor(private db: DB, private tenant = "default") {}

  record(span: ToolCallSpan): void {
    this.db.prepare(`
      INSERT INTO tool_calls (id, tenant_id, tool_name, tool_version, agent_uri, provider, latency_ms, status, error_class, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId(), this.tenant, span.tool, span.version, span.agentUri,
      span.provider, span.latencyMs, span.status,
      span.errorClass ?? null, span.costUsd ?? null,
    );
    for (const fn of this.listeners) {
      try { fn(span); } catch { /* a broken SSE client must not fail the call */ }
    }
  }

  on(listener: SpanListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  query(opts: { tool?: string; agent?: string; limit?: number } = {}): ToolCallSpan[] {
    const clauses = ["tenant_id=?"];
    const args: unknown[] = [this.tenant];
    if (opts.tool) { clauses.push("tool_name=?"); args.push(opts.tool); }
    if (opts.agent) { clauses.push("agent_uri=?"); args.push(opts.agent); }
    args.push(Math.min(opts.limit ?? 100, 1000));
    const rows = this.db.prepare(
      `SELECT * FROM tool_calls WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, rowid DESC LIMIT ?`
    ).all(...args) as CallRow[];
    return rows.map(r => ({
      tool: r.tool_name, version: r.tool_version, agentUri: r.agent_uri,
      provider: r.provider, latencyMs: r.latency_ms, status: r.status,
      errorClass: r.error_class ?? undefined, costUsd: r.cost_usd ?? undefined,
    }));
  }

  /** Aggregate used by the dashboard/API for p50/p95 and spend totals. */
  summary(tool?: string): { calls: number; errors: number; avgLatencyMs: number; totalCostUsd: number } {
    const clause = tool ? "AND tool_name=?" : "";
    const args = tool ? [this.tenant, tool] : [this.tenant];
    const row = this.db.prepare(`
      SELECT COUNT(*) AS calls,
             SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS errors,
             COALESCE(AVG(latency_ms), 0) AS avg_latency,
             COALESCE(SUM(cost_usd), 0) AS total_cost
      FROM tool_calls WHERE tenant_id=? ${clause}
    `).get(...args) as { calls: number; errors: number; avg_latency: number; total_cost: number };
    return {
      calls: row.calls ?? 0,
      errors: row.errors ?? 0,
      avgLatencyMs: Math.round(row.avg_latency ?? 0),
      totalCostUsd: Number((row.total_cost ?? 0).toFixed(6)),
    };
  }
}
