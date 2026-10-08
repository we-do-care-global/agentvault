// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "@we-do-care/agentvault-core";
import { can, RBAC, evaluate, semverMatch, inHours, SlidingWindowCounter, PolicyStore, type EvalInput } from "../src/index";
import type { PolicyRule } from "@we-do-care/agentvault-shared";

const base = (over: Partial<EvalInput> = {}): EvalInput => ({
  tool: "acme/tool", version: "1.0.0", role: "agent", context: "production",
  callsLastMinute: 0, callsToday: 0, costTodayUsd: 0,
  nowUtc: new Date("2026-09-26T12:00:00Z"),
  ...over,
});

const rule = (over: Partial<PolicyRule> = {}): PolicyRule => ({
  id: "p1", match: { tool: "acme/tool" }, action: "allow", priority: 100, ...over,
});

describe("RBAC", () => {
  it("grants the documented matrix", () => {
    expect(can("agent", "execute")).toBe(true);
    expect(can("agent", "secrets.read")).toBe(true);
    expect(can("agent", "approve")).toBe(false);
    expect(can("agent", "secrets.write")).toBe(false);
    expect(can("developer", "secrets.write")).toBe(true);
    expect(can("developer", "approve")).toBe(false);
    expect(can("admin", "approve")).toBe(true);
    expect(can("super_admin", "registry.write")).toBe(true);
  });

  it("fails closed for an unknown role", () => {
    expect(can("root" as never, "execute")).toBe(false);
    expect(Object.keys(RBAC)).toEqual(["agent", "developer", "admin", "super_admin"]);
  });
});

describe("semverMatch", () => {
  it("matches exact, caret and ranges", () => {
    expect(semverMatch("1.0.0", "1.0.0")).toBe(true);
    expect(semverMatch("1.0.0", "1.0.1")).toBe(false);
    expect(semverMatch("^1.2.0", "1.9.9")).toBe(true);
    expect(semverMatch("^1.2.0", "2.0.0")).toBe(false);
    expect(semverMatch(">=1.0.0 <2.0.0", "1.5.0")).toBe(true);
    expect(semverMatch(">=1.0.0 <2.0.0", "2.0.0")).toBe(false);
    expect(semverMatch(">=1.0.0", "0.9.0")).toBe(false);
  });
});

describe("inHours", () => {
  it("matches a UTC window and wraps midnight", () => {
    expect(inHours(["09:00-17:00"], new Date("2026-09-26T12:00:00Z"))).toBe(true);
    expect(inHours(["09:00-17:00"], new Date("2026-09-26T18:00:00Z"))).toBe(false);
    expect(inHours(["22:00-02:00"], new Date("2026-09-26T23:30:00Z"))).toBe(true);
    expect(inHours(["22:00-02:00"], new Date("2026-09-26T01:30:00Z"))).toBe(true);
    expect(inHours(["22:00-02:00"], new Date("2026-09-26T12:00:00Z"))).toBe(false);
  });
});

describe("evaluate", () => {
  it("denies when no policy matches (fail-closed)", () => {
    expect(evaluate([], base())).toEqual({ decision: "deny", reason: "no_matching_policy" });
    expect(evaluate([rule()], base({ tool: "other/tool" }))).toEqual({ decision: "deny", reason: "no_matching_policy" });
  });

  it("allows on a matching allow rule", () => {
    expect(evaluate([rule()], base())).toEqual({ decision: "allow", policyId: "p1" });
  });

  it("honours priority: highest matching rule wins", () => {
    const policies = [rule({ id: "low", action: "deny", priority: 1 }), rule({ id: "high", action: "allow", priority: 500 })];
    expect(evaluate(policies, base()).policyId).toBe("high");
  });

  it("denies on rate limit, quota, budget and hours", () => {
    expect(evaluate([rule({ conditions: { max_calls_per_minute: 5 } })], base({ callsLastMinute: 5 })).reason).toBe("rate_limit_exceeded");
    expect(evaluate([rule({ conditions: { max_calls_per_day: 10 } })], base({ callsToday: 10 })).reason).toBe("daily_quota_exceeded");
    expect(evaluate([rule({ conditions: { max_cost_per_day_usd: 1 } })], base({ costTodayUsd: 1 })).reason).toBe("budget_exceeded");
    expect(evaluate([rule({ conditions: { allowed_hours_utc: ["09:00-17:00"] } })], base({ nowUtc: new Date("2026-09-26T23:00:00Z") })).reason)
      .toBe("outside_allowed_hours");
  });

  it("matches on role, context and version range", () => {
    const p = rule({ match: { tool: "acme/tool@^1.0.0", agent_role: ["admin"], context: ["staging"] } });
    expect(evaluate([p], base({ role: "agent" })).decision).toBe("deny");
    expect(evaluate([p], base({ role: "admin", context: "dev" })).decision).toBe("deny");
    expect(evaluate([p], base({ role: "admin", context: "staging" })).decision).toBe("allow");
    expect(evaluate([p], base({ role: "admin", context: "staging", version: "2.0.0" })).decision).toBe("deny");
  });

  it("returns approval for approval rules", () => {
    expect(evaluate([rule({ action: "approval" })], base()).decision).toBe("approval");
  });
});

describe("SlidingWindowCounter", () => {
  it("counts hits inside a trailing 60s window", () => {
    const c = new SlidingWindowCounter();
    const t0 = 1_000_000;
    expect(c.hit("k", t0)).toBe(1);
    expect(c.hit("k", t0 + 1000)).toBe(2);
    expect(c.count("k", t0 + 30_000)).toBe(2);
    expect(c.count("k", t0 + 61_000)).toBe(0); // both aged out
    expect(c.count("k", t0 + 61_000)).toBe(0);
  });

  it("keys are independent and resettable", () => {
    const c = new SlidingWindowCounter();
    c.hit("a"); c.hit("b");
    expect(c.count("a")).toBe(1);
    c.reset("a");
    expect(c.count("a")).toBe(0);
    expect(c.count("b")).toBe(1);
  });
});

describe("PolicyStore", () => {
  let db: DB;
  let store: PolicyStore;

  beforeEach(() => { db = openDb(":memory:"); store = new PolicyStore(db, "t1"); });
  afterEach(() => db.close());

  it("stores, updates, lists by priority and removes", () => {
    store.put(rule({ id: "a", priority: 10 }));
    store.put(rule({ id: "b", priority: 900 }));
    expect(store.list().map(p => p.id)).toEqual(["b", "a"]);

    store.put(rule({ id: "a", priority: 10, action: "deny" }));
    expect(store.list()).toHaveLength(2);
    expect(store.list().find(p => p.id === "a")?.action).toBe("deny");

    expect(store.remove("a")).toBe(true);
    expect(store.remove("a")).toBe(false);
    expect(store.list().map(p => p.id)).toEqual(["b"]);
  });

  it("rejects an incomplete rule", () => {
    expect(() => store.put({ id: "x" } as PolicyRule)).toThrow(/id and action/);
  });

  it("isolates tenants", () => {
    store.put(rule({ id: "a" }));
    expect(new PolicyStore(db, "t2").list()).toHaveLength(0);
  });
});
