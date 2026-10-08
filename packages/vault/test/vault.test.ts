// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

import { describe, it, expect } from "vitest";
import { openDb } from "@we-do-care/agentvault-core";
import { SecretVault, AuditLedger, seal, open, generateDek, deriveKek, sha256hex, GENESIS } from "../src/index";

const PASS = "correct horse battery staple";

describe("envelope crypto", () => {
  it("round-trips a value through seal/open", () => {
    const key = generateDek();
    const box = seal(key, Buffer.from("hello", "utf8"));
    expect(open(key, box).toString("utf8")).toBe("hello");
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const key = generateDek();
    const box = seal(key, Buffer.from("hello", "utf8"));
    const broken = Buffer.from(box.ciphertext);
    broken[0] ^= 0xff;
    expect(() => open(key, { ...box, ciphertext: broken })).toThrow();
  });

  it("binds AAD: a box sealed for one AAD will not open under another", () => {
    const key = generateDek();
    const box = seal(key, Buffer.from("x", "utf8"), Buffer.from("tenantA|ns|key|1"));
    expect(() => open(key, box, Buffer.from("tenantB|ns|key|1"))).toThrow();
  });

  it("derives a stable 32-byte KEK from the same passphrase", async () => {
    const a = await deriveKek(PASS);
    const b = await deriveKek(PASS);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
  });

  it("hashes deterministically", () => {
    expect(sha256hex("abc")).toBe(sha256hex(Buffer.from("abc", "utf8")));
    expect(sha256hex("abc")).toHaveLength(64);
  });
});

describe("SecretVault", () => {
  it("stores, reads, rotates and revokes", async () => {
    const db = openDb(":memory:");
    const vault = new SecretVault(db, "default", PASS);

    const meta = await vault.put("slack", "webhook", "https://hooks.slack.com/secret");
    expect(meta.key_version).toBe(1);
    expect(await vault.get("slack", "webhook")).toBe("https://hooks.slack.com/secret");

    const rotated = await vault.rotate("slack", "webhook");
    expect(rotated.key_version).toBe(2);
    expect(await vault.get("slack", "webhook")).toBe("https://hooks.slack.com/secret");

    const rotated2 = await vault.rotate("slack", "webhook", "https://hooks.slack.com/new");
    expect(rotated2.key_version).toBe(3);
    expect(await vault.get("slack", "webhook")).toBe("https://hooks.slack.com/new");

    expect(vault.list().map(s => `${s.namespace}/${s.key}`)).toEqual(["slack/webhook"]);
    expect(vault.revoke("slack", "webhook")).toBe(true);
    await expect(vault.get("slack", "webhook")).rejects.toThrow(/not found/);
  });

  it("rejects reads with the wrong master passphrase", async () => {
    const db = openDb(":memory:");
    await new SecretVault(db, "default", PASS).put("ns", "k", "v");
    const other = new SecretVault(db, "default", "wrong passphrase");
    await expect(other.get("ns", "k")).rejects.toThrow();
  });

  it("enforces TTL expiry", async () => {
    const db = openDb(":memory:");
    const vault = new SecretVault(db, "default", PASS);
    await vault.put("ns", "short", "v", { ttlSeconds: -1 });
    await expect(vault.get("ns", "short")).rejects.toThrow(/expired/);
  });

  it("isolates tenants", async () => {
    const db = openDb(":memory:");
    const a = new SecretVault(db, "tenant-a", PASS);
    const b = new SecretVault(db, "tenant-b", PASS);
    await a.put("ns", "k", "a-value");
    await expect(b.get("ns", "k")).rejects.toThrow(/not found/);
  });
});

describe("AuditLedger", () => {
  it("chains entries from genesis and verifies clean", () => {
    const db = openDb(":memory:");
    const ledger = new AuditLedger(db, "default");
    const first = ledger.append("agent://a", "tool.allowed", "tool:x@1.0.0", { policyId: "p1" });
    expect(first.prev_hash).toBe(GENESIS);
    ledger.append("agent://a", "tool.denied", "tool:y@1.0.0", { reason: "rate_limit_exceeded" });
    ledger.append("cli", "secret.create", "vault://ns/k");
    expect(ledger.verifyChain()).toEqual({ ok: true });
    expect(ledger.query(10)).toHaveLength(3);
  });

  it("detects tampering and reports the first bad sequence", () => {
    const db = openDb(":memory:");
    const ledger = new AuditLedger(db, "default");
    ledger.append("cli", "tool.register", "tool:a@1");
    ledger.append("cli", "tool.register", "tool:b@1");
    const bad = ledger.append("cli", "tool.remove", "tool:a@1");
    ledger.append("cli", "policy.upsert", "policy:p1");

    expect(ledger.tamper(bad.seq, "actor", "attacker")).toBe(true);
    const res = ledger.verifyChain();
    expect(res.ok).toBe(false);
    expect(res.firstBadSeq).toBe(bad.seq);
  });

  it("keeps chains independent per tenant", () => {
    const db = openDb(":memory:");
    const a = new AuditLedger(db, "t1");
    const b = new AuditLedger(db, "t2");
    a.append("x", "y", "z");
    b.append("x", "y", "z");
    expect(a.verifyChain().ok).toBe(true);
    expect(b.verifyChain().ok).toBe(true);
    expect(a.query()).toHaveLength(1);
  });
});
