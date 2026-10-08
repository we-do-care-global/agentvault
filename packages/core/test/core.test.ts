// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { openDb, ToolRegistry, newId, type DB } from "../src/index";
import type { ToolManifest } from "@we-do-care/agentvault-shared";

const manifest = (over: Partial<ToolManifest> = {}): ToolManifest => ({
  enact: "2.0.0",
  vault: "1.0.0",
  name: "acme/tool",
  version: "1.0.0",
  description: "test tool",
  inputSchema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
  ...over,
});

describe("openDb", () => {
  it("migrates the schema idempotently", () => {
    const db = openDb(":memory:");
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as Array<{ name: string }>;
    expect(tables.map(t => t.name)).toEqual(
      expect.arrayContaining(["tools", "secrets", "policies", "audit_ledger", "tool_calls"])
    );
    db.close();
    // reopening must not throw on CREATE TABLE IF NOT EXISTS
    expect(() => openDb(":memory:").close()).not.toThrow();
  });

  it("mints unique ids", () => {
    expect(newId()).not.toBe(newId());
  });
});

describe("ToolRegistry", () => {
  let db: DB;
  let registry: ToolRegistry;

  beforeEach(() => { db = openDb(":memory:"); registry = new ToolRegistry(db, "t1"); });
  afterEach(() => db.close());

  it("registers, reads back and lists", () => {
    const t = registry.register(manifest(), "High", "acme");
    expect(t.trust_level).toBe("High");
    expect(registry.get("acme/tool")?.name).toBe("acme/tool");
    expect(registry.get("acme/tool", "1.0.0")?.publisher).toBe("acme");
    expect(registry.list()).toHaveLength(1);
  });

  it("upserts the same name@version instead of duplicating", () => {
    registry.register(manifest(), "Low");
    registry.register(manifest({ description: "updated" }), "High");
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].manifest.description).toBe("updated");
    expect(list[0].trust_level).toBe("High");
  });

  it("returns null for an unknown tool", () => {
    expect(registry.get("nope/nope")).toBeNull();
  });

  it("removes by exact version only", () => {
    registry.register(manifest());
    registry.register(manifest({ version: "2.0.0" }));
    expect(registry.remove("acme/tool", "1.0.0")).toBe(true);
    expect(registry.remove("acme/tool", "1.0.0")).toBe(false);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].version).toBe("2.0.0");
  });

  it("isolates tenants", () => {
    registry.register(manifest());
    expect(new ToolRegistry(db, "t2").list()).toHaveLength(0);
  });
});
