// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

import { describe, it, expect } from "vitest";
import { loadManifest, parseManifest } from "@we-do-care/agentvault-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

describe("slack-webhook example manifest", () => {
  it("parses and matches the documented governance contract", () => {
    const m = loadManifest(join(here, "..", "manifest.yaml"));
    expect(m.name).toBe("we-do-care/slack-webhook");
    expect(m.version).toBe("1.0.0");
    expect(m.governance?.max_calls_per_minute).toBe(10);
    expect(m.governance?.required_role).toContain("agent");
    expect(m.secrets?.[0].source).toBe("vault://default/slack/webhook");
    expect(Object.keys(m.providers ?? {})).toEqual(["gemini", "openai", "anthropic", "ollama"]);
  });
});

describe("manifest validation", () => {
  it("rejects a manifest with a non org/tool name", () => {
    expect(() => parseManifest(`
enact: "2.0.0"
vault: "1.0.0"
name: "no-slash"
version: "1.0.0"
inputSchema:
  type: object
`)).toThrow(/org\/tool/);
  });

  it("rejects a secret source that is not a vault:// pointer", () => {
    expect(() => parseManifest(`
enact: "2.0.0"
vault: "1.0.0"
name: "acme/thing"
version: "1.0.0"
inputSchema:
  type: object
secrets:
  - name: API_KEY
    source: "env://API_KEY"
`)).toThrow(/vault:\/\//);
  });

  it("reads enact.md frontmatter", () => {
    const m = parseManifest(`---
enact: "2.0.0"
vault: "1.0.0"
name: "acme/thing"
version: "1.0.0"
description: from frontmatter
inputSchema:
  type: object
---

# prose that must be ignored
`);
    expect(m.description).toBe("from frontmatter");
  });
});
