// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync as run } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "dist", "index.js");
const REPO = join(here, "..", "..", "..");
const WORK = join(tmpdir(), `agentvault-cli-${process.pid}`);
const DB = join(WORK, "vault.db");

process.env.AGENTVAULT_DB = DB;
process.env.AGENTVAULT_MASTER_KEY = "cli-test-master-key";

function cli(args: string[], input?: string): string {
  return run(process.execPath, [CLI, ...args], {
    env: process.env,
    input,
    encoding: "utf8",
    stdio: input === undefined ? "pipe" : ["pipe", "pipe", "pipe"],
  });
}

function cliExpectFail(args: string[]): { status: number; stderr: string } {
  try {
    cli(args);
    return { status: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? 1, stderr: err.stderr ?? "" };
  }
}

beforeAll(() => {
  mkdirSync(WORK, { recursive: true });
});

afterAll(() => {
  try { rmSync(WORK, { recursive: true, force: true }); } catch { /* nothing to clean */ }
});

describe("agentvault CLI", () => {
  it("reports its version and help with the brand line", () => {
    expect(cli(["--version"]).trim()).toBe("0.1.3");
    const help = cli(["--help"]);
    expect(help).toContain("agentvault");
    expect(help).toContain("We Do Care Global");
    for (const cmd of ["init", "doctor", "tools", "vault", "policy", "telemetry", "audit", "serve"]) {
      expect(help).toContain(cmd);
    }
  });

  it("initialises the database and reports a healthy doctor run", () => {
    expect(cli(["init"])).toContain("Initialized AgentVault");
    const doctor = cli(["doctor"]);
    expect(doctor).toContain("AgentVault v0.1.3");
    expect(doctor).toContain("Audit chain   : ok");
    expect(doctor).toContain("AGENTVAULT_MASTER_KEY");
  });

  it("validates and registers the example manifest, then lists it", () => {
    const manifest = join(REPO, "examples", "slack-webhook", "manifest.yaml");
    expect(cli(["tools", "validate", manifest])).toContain("Valid: we-do-care/slack-webhook@1.0.0");

    expect(cli(["tools", "list"])).toContain("No tools registered.");
    expect(cli(["tools", "register", manifest, "--trust", "High"])).toContain("Registered we-do-care/slack-webhook@1.0.0");
    expect(cli(["tools", "list"])).toContain("we-do-care/slack-webhook@1.0.0");
    expect(cli(["tools", "list"])).toContain("[High]");

    const shown = JSON.parse(cli(["tools", "show", "we-do-care/slack-webhook", "--tool-version", "1.0.0"]));
    expect(shown.manifest.secrets[0].source).toBe("vault://default/slack/webhook");

    expect(cli(["tools", "remove", "we-do-care/slack-webhook", "--tool-version", "1.0.0"])).toContain("Removed");
    expect(cliExpectFail(["tools", "show", "we-do-care/slack-webhook"]).status).toBe(1);
  });

  it("rejects an invalid manifest with a non-zero exit", () => {
    const bad = join(WORK, "bad.yaml");
    writeFileSync(bad, "enact: '2.0.0'\nvault: '1.0.0'\nname: nope\nversion: '1.0.0'\ninputSchema:\n  type: object\n");
    const res = cliExpectFail(["tools", "validate", bad]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Invalid manifest");
  });

  it("stores a secret from stdin, lists, rotates, reads and revokes it", () => {
    expect(cli(["vault", "set", "webhook", "--namespace", "slack"], "https://hooks.slack.com/test"))
      .toContain("Secret stored: vault://slack/webhook (v1)");

    const list = cli(["vault", "list"]);
    expect(list).toContain("vault://slack/webhook (v1)");
    expect(list).not.toContain("hooks.slack.com"); // never leaks plaintext

    expect(cli(["vault", "rotate", "webhook", "--namespace", "slack"])).toContain("-> v2");
    expect(cli(["vault", "rotate", "webhook", "--namespace", "slack", "--value", "https://hooks.slack.com/new"]))
      .toContain("-> v3");
    expect(cli(["vault", "get", "webhook", "--namespace", "slack"]).trim()).toBe("https://hooks.slack.com/new");

    expect(cli(["vault", "revoke", "webhook", "--namespace", "slack"])).toContain("Revoked");
    expect(cli(["vault", "list"])).toContain("No secrets stored.");
    expect(cliExpectFail(["vault", "revoke", "webhook", "--namespace", "slack"]).status).toBe(1);
  });

  it("attaches, lists and removes policies", () => {
    expect(cli(["policy", "list"])).toContain("fail-closed");
    expect(cli(["policy", "attach", "we-do-care/slack-webhook", "--role", "agent", "--max-calls", "10"]))
      .toContain("Attached policy we-do-care-slack-webhook-agent");
    expect(cli(["policy", "list"])).toContain("[allow]");
    expect(cli(["policy", "remove", "we-do-care-slack-webhook-agent"])).toContain("Removed policy");
    expect(cliExpectFail(["policy", "remove", "nope"]).status).toBe(1);
  });
});
