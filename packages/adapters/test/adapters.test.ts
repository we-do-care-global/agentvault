// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import { describe, it, expect } from "vitest";
import { adapters, adapterFor, type ProviderAdapter } from "../src/index";
import type { Provider, ToolSchema } from "@we-do-care/agentvault-shared";

const schema: ToolSchema = {
  name: "acme_search",
  description: "search things",
  parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
};

const providers: Provider[] = ["gemini", "openai", "anthropic", "ollama"];

describe("adapter registry", () => {
  it("exposes all four providers", () => {
    expect(providers.every(p => adapters[p])).toBe(true);
    expect(adapterFor("anthropic").provider).toBe("anthropic");
  });

  it("declares a wire format per provider", () => {
    const gemini = adapters.gemini.formatTools([schema]) as any[];
    expect(Array.isArray(gemini)).toBe(true);
    expect(gemini[0].functionDeclarations[0].parameters).toEqual(schema.parameters);

    const openai = adapters.openai.formatTools([schema]) as any[];
    expect(openai[0].type).toBe("function");
    expect(openai[0].function.name).toBe("acme_search");

    const anthropic = adapters.anthropic.formatTools([schema]) as any[];
    expect(anthropic[0].input_schema).toEqual(schema.parameters);

    const ollama = adapters.ollama.formatTools([schema]) as any[];
    expect(ollama[0].function.name).toBe("acme_search");
  });

  it("marks ollama as non-parallel, the rest as parallel", () => {
    expect(adapters.ollama.supportsParallel()).toBe(false);
    for (const p of ["gemini", "openai", "anthropic"] as Provider[]) {
      expect(adapters[p].supportsParallel()).toBe(true);
      expect(adapters[p].supportsStreaming()).toBe(true);
    }
  });
});

describe("parseToolCall -> NormalizedCall", () => {
  it("normalizes gemini functionCalls", () => {
    const calls = adapters.gemini.parseToolCall({
      functionCalls: [{ name: "acme_search", args: { q: "hi" }, id: "g1" }],
    });
    expect(calls[0]).toMatchObject({ name: "acme_search", arguments: { q: "hi" }, callId: "g1", provider: "gemini" });
  });

  it("normalizes openai tool_calls and parses JSON arguments", () => {
    const calls = adapters.openai.parseToolCall({
      choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "acme_search", arguments: '{"q":"hi"}' } }] } }],
    });
    expect(calls[0]).toMatchObject({ name: "acme_search", arguments: { q: "hi" }, callId: "c1", provider: "openai" });
  });

  it("survives malformed openai arguments instead of throwing", () => {
    const calls = adapters.openai.parseToolCall({
      choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "acme_search", arguments: "{not json" } }] } }],
    });
    expect(calls[0].arguments).toEqual({});
  });

  it("normalizes anthropic tool_use blocks and ignores text blocks", () => {
    const calls = adapters.anthropic.parseToolCall({
      content: [
        { type: "text", text: "thinking" },
        { type: "tool_use", id: "t1", name: "acme_search", input: { q: "hi" } },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "acme_search", arguments: { q: "hi" }, callId: "t1", provider: "anthropic" });
  });

  it("normalizes ollama tool calls in both string and object argument form", () => {
    const calls = adapters.ollama.parseToolCall({
      message: { tool_calls: [
        { function: { name: "a", arguments: '{"q":1}' } },
        { id: "o2", function: { name: "b", arguments: { q: 2 } } },
      ] },
    });
    expect(calls.map(c => c.arguments)).toEqual([{ q: 1 }, { q: 2 }]);
    expect(calls[1].callId).toBe("o2");
  });

  it("returns an empty array for responses with no tool calls", () => {
    for (const p of providers) {
      expect(adapterFor(p).parseToolCall({})).toEqual([]);
      expect(adapterFor(p).parseToolCall(null)).toEqual([]);
    }
  });
});

describe("formatToolResult", () => {
  it("uses the provider's result envelope", () => {
    expect((adapters.openai.formatToolResult("c1", { ok: true }) as any).tool_call_id).toBe("c1");
    expect((adapters.anthropic.formatToolResult("t1", { ok: true }) as any).tool_use_id).toBe("t1");
    // gemini keys functionResponse by function name, not call id
    const g = adapters.gemini.formatToolResult("c1", { ok: true }, "acme_search") as any;
    expect(g.functionResponse.name).toBe("acme_search");
    expect(g.functionResponse.response.result).toEqual({ ok: true });
  });
});
