import { describe, it, expect, afterEach } from "vitest";
import { openDb, saveDb } from "../src/db.ts";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB = "./data/test-persistence.db";

afterEach(() => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

function queryOne(db: any, sql: string): string[] | null {
  const result = db.exec(sql);
  if (!result || result.length === 0 || !result[0].values.length) return null;
  return result[0].values[0] as string[];
}

describe("AgentVault persistence", () => {
  it("Data persists across close/reopen when saveDb is called", async () => {
    const db1 = await openDb(TEST_DB);
    db1.exec(`CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY, value TEXT)`);
    db1.exec(`INSERT INTO test_table (id, value) VALUES ('key1', 'value1')`);
    const r1 = queryOne(db1, "SELECT value FROM test_table WHERE id = 'key1'");
    expect(r1).toEqual(["value1"]);

    saveDb(db1, TEST_DB);
    db1.close();

    const db2 = await openDb(TEST_DB);
    const r2 = queryOne(db2, "SELECT value FROM test_table WHERE id = 'key1'");
    expect(r2).toEqual(["value1"]);
    db2.close();
  });

  it("WITHOUT saveDb, data is LOST on close/reopen (the production bug)", async () => {
    const db1 = await openDb(TEST_DB);
    db1.exec(`CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY, value TEXT)`);
    db1.exec(`INSERT INTO test_table (id, value) VALUES ('key1', 'value1')`);
    // NOT calling saveDb — simulating production bug
    db1.close();

    const db2 = await openDb(TEST_DB);
    const tables = db2.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'");
    expect(tables.length).toBe(0);
    db2.close();
  });

  it("Multiple writes followed by saveDb all persist", async () => {
    const db1 = await openDb(TEST_DB);
    db1.exec(`CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY, value TEXT)`);
    db1.exec(`INSERT INTO test_table (id, value) VALUES ('key1', 'value1')`);
    db1.exec(`INSERT INTO test_table (id, value) VALUES ('key2', 'value2')`);
    db1.exec(`INSERT INTO test_table (id, value) VALUES ('key3', 'value3')`);

    saveDb(db1, TEST_DB);
    db1.close();

    const db2 = await openDb(TEST_DB);
    expect(queryOne(db2, "SELECT value FROM test_table WHERE id = 'key1'")).toEqual(["value1"]);
    expect(queryOne(db2, "SELECT value FROM test_table WHERE id = 'key2'")).toEqual(["value2"]);
    expect(queryOne(db2, "SELECT value FROM test_table WHERE id = 'key3'")).toEqual(["value3"]);
    const count = queryOne(db2, "SELECT COUNT(*) as c FROM test_table");
    expect(count).toEqual([3]);
    db2.close();
  });

  it("saveDb followed by close then reopen preserves schema", async () => {
    const db1 = await openDb(TEST_DB);
    db1.exec(`CREATE TABLE IF NOT EXISTS schema_test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);
    db1.exec(`INSERT INTO schema_test (name) VALUES ('test-name')`);
    saveDb(db1, TEST_DB);
    db1.close();

    const db2 = await openDb(TEST_DB);
    const row = queryOne(db2, "SELECT name FROM schema_test WHERE id = 1");
    expect(row).toEqual(["test-name"]);
    db2.close();
  });
});
