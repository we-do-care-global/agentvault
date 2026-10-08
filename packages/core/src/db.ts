// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type DB = Database.Database;

/** SQLite is the v0.1.0 store; Postgres + Drizzle lands in v0.2.0. */
export function openDb(path = "./data/vault.db"): DB {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      manifest TEXT NOT NULL,
      enact_compat INTEGER DEFAULT 1,
      trust_level TEXT NOT NULL DEFAULT 'Medium',
      publisher TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, name, version)
    );

    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM',
      ciphertext BLOB NOT NULL,
      nonce BLOB NOT NULL,
      tag BLOB NOT NULL,
      aad BLOB,
      wrapped_dek BLOB NOT NULL,
      dek_nonce BLOB NOT NULL,
      dek_tag BLOB NOT NULL,
      scope TEXT,
      ttl_seconds INTEGER,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, namespace, key, key_version)
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      rule TEXT NOT NULL,
      priority INTEGER DEFAULT 100,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS audit_ledger (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      context TEXT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      tool_name TEXT NOT NULL,
      tool_version TEXT NOT NULL,
      agent_uri TEXT NOT NULL,
      provider TEXT NOT NULL,
      latency_ms INTEGER,
      status TEXT,
      error_class TEXT,
      cost_usd REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_ledger(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_calls_tool ON tool_calls(tool_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_calls_agent ON tool_calls(agent_uri, created_at DESC);
  `);
}

export function newId(): string { return randomUUID(); }
