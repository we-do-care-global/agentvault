// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import type { PolicyRule, Context, Role } from "@we-do-care/agentvault-shared";

export interface EvalInput {
  tool: string;
  version: string;
  role: Role;
  context: Context;
  callsLastMinute: number;
  callsToday: number;
  costTodayUsd: number;
  nowUtc: Date;
}

export interface Decision {
  decision: "allow" | "deny" | "approval";
  policyId?: string;
  reason?: string;
}

function parse(v: string): number[] {
  return v.split(".").map(n => Number.parseInt(n, 10) || 0);
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Supports exact ("1.0.0"), caret ("^1.0.0") and ranges (">=1.0.0 <2.0.0"). */
export function semverMatch(range: string, version: string): boolean {
  const v = parse(version);
  const range_ = range.trim();

  if (range_.startsWith("^")) {
    const base = parse(range_.slice(1));
    const upper = [base[0] + 1, 0, 0];
    return cmp(v, base) >= 0 && cmp(v, upper) < 0;
  }

  if (range_.startsWith(">=")) {
    const parts = range_.slice(2).trim().split(/\s+/);
    if (cmp(v, parse(parts[0])) < 0) return false;
    for (const p of parts.slice(1)) {
      if (p.startsWith("<")) { if (cmp(v, parse(p.slice(1))) >= 0) return false; }
      else if (p.startsWith(">")) { if (cmp(v, parse(p.slice(1))) <= 0) return false; }
      else if (p.startsWith("=")) { if (cmp(v, parse(p.slice(1))) !== 0) return false; }
    }
    return true;
  }

  return range_ === version;
}

/** True when [a,b] half-open UTC window "HH:MM-HH:MM" contains now. */
export function inHours(ranges: string[], date: Date): boolean {
  const hhmm = date.toISOString().slice(11, 16);
  return ranges.some(r => {
    const [a, b] = r.split("-");
    if (!a || !b) return false;
    return a <= b ? hhmm >= a && hhmm <= b : hhmm >= a || hhmm <= b; // wraps midnight
  });
}

export function matches(p: PolicyRule, input: EvalInput): boolean {
  if (p.match.tool) {
    const [toolName, range] = p.match.tool.split("@");
    if (toolName !== input.tool) return false;
    if (range && !semverMatch(range, input.version)) return false;
  }
  if (p.match.agent_role && !p.match.agent_role.includes(input.role)) return false;
  if (p.match.context && !p.match.context.includes(input.context)) return false;
  return true;
}

/**
 * Fail-closed: the highest-priority matching policy decides. If a condition is
 * breached the call is denied with a machine-readable reason. If nothing
 * matches at all the call is denied (no_matching_policy).
 */
export function evaluate(policies: PolicyRule[], input: EvalInput): Decision {
  const sorted = [...policies].sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
  for (const p of sorted) {
    if (!matches(p, input)) continue;
    const c = p.conditions ?? {};
    if (c.max_calls_per_minute !== undefined && input.callsLastMinute >= c.max_calls_per_minute) {
      return { decision: "deny", policyId: p.id, reason: "rate_limit_exceeded" };
    }
    if (c.max_calls_per_day !== undefined && input.callsToday >= c.max_calls_per_day) {
      return { decision: "deny", policyId: p.id, reason: "daily_quota_exceeded" };
    }
    if (c.max_cost_per_day_usd !== undefined && input.costTodayUsd >= c.max_cost_per_day_usd) {
      return { decision: "deny", policyId: p.id, reason: "budget_exceeded" };
    }
    if (c.allowed_hours_utc && !inHours(c.allowed_hours_utc, input.nowUtc)) {
      return { decision: "deny", policyId: p.id, reason: "outside_allowed_hours" };
    }
    return { decision: p.action, policyId: p.id };
  }
  return { decision: "deny", reason: "no_matching_policy" };
}
