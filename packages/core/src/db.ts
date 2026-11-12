// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import initSqlJs from "sql.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type DB = any;

// sql.js is WASM-based and must be initialized asynchronously.
// The WASM binary is bundled with the sql.js npm package.
let sqlPromise: Promise<unknown> | null = null;

async function getSql(): Promise<unknown> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file: string) => {
        return new URL("../../../node_modules/.pnpm/sql.js@1.16.0/node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).href;
      },
    });
  }
  return sqlPromise;
}

/** SQLite is the v0.1.0 store; Postgres + Drizzle lands in v0.2.0. */
export async function openDb(path = "./data/vault.db"): Promise<DB> {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const SQL = await getSql();
  const Database = (SQL as any).Database;

  let db: DB;
  if (path !== ":memory:" && existsSync(path)) {
    // Load existing database from file
    const filebuffer = readFileSync(path);
    db = new Database(filebuffer) as DB;
  } else {
    db = new Database() as DB;
  }

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/** Persist an in-memory sql.js database to disk. */
export function saveDb(db: DB, path = "./data/vault.db"): void {
  if (path === ":memory:") return;
  const data = db.export();
  writeFileSync(path, Buffer.from(data));
}

function migrate(db: DB) {
  (db as any).exec(`
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

export function newId(): string {
  return randomUUID();
}
