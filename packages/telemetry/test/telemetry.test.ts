// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "@we-do-care/agentvault-core";
import { Telemetry, type ToolCallSpan } from "../src/index";

const span = (over: Partial<ToolCallSpan> = {}): ToolCallSpan => ({
  tool: "acme/tool", version: "1.0.0", agentUri: "agent://a", provider: "openai",
  latencyMs: 120, status: "ok", costUsd: 0.0023, ...over,
});

describe("Telemetry", () => {
  let db: DB;
  let t: Telemetry;

  beforeEach(() => { db = openDb(":memory:"); t = new Telemetry(db, "t1"); });
  afterEach(() => db.close());

  it("records and queries spans", () => {
    t.record(span());
    t.record(span({ tool: "other/tool", agentUri: "agent://b", status: "error", errorClass: "provider_error" }));
    expect(t.query()).toHaveLength(2);
    expect(t.query({ tool: "acme/tool" })).toHaveLength(1);
    expect(t.query({ agent: "agent://b" })[0].errorClass).toBe("provider_error");
  });

  it("notifies listeners and supports unsubscribe", () => {
    const seen: ToolCallSpan[] = [];
    const off = t.on(s => seen.push(s));
    t.record(span());
    off();
    t.record(span());
    expect(seen).toHaveLength(1);
  });

  it("keeps recording when a listener throws", () => {
    t.on(() => { throw new Error("bad sse client"); });
    expect(() => t.record(span())).not.toThrow();
    expect(t.query()).toHaveLength(1);
  });

  it("summarises calls, errors, latency and cost", () => {
    t.record(span({ latencyMs: 100, costUsd: 0.002 }));
    t.record(span({ latencyMs: 300, costUsd: 0.003, status: "denied", errorClass: "rate_limit_exceeded" }));
    const s = t.summary();
    expect(s.calls).toBe(2);
    expect(s.errors).toBe(1);
    expect(s.avgLatencyMs).toBe(200);
    expect(s.totalCostUsd).toBeCloseTo(0.005, 6);
  });

  it("returns an empty summary and isolates tenants", () => {
    expect(t.summary()).toEqual({ calls: 0, errors: 0, avgLatencyMs: 0, totalCostUsd: 0 });
    t.record(span());
    expect(new Telemetry(db, "t2").summary().calls).toBe(0);
  });
});
