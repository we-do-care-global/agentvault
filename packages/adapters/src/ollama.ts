// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import type { ToolSchema, NormalizedCall } from "@we-do-care/agentvault-shared";
import type { ProviderAdapter } from "./types.js";

interface OllamaCall { id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }

/** Ollama exposes an OpenAI-compatible /v1/chat/completions surface. */
export class OllamaAdapter implements ProviderAdapter {
  readonly provider = "ollama" as const;

  formatTool(s: ToolSchema) {
    return { type: "function", function: { name: s.name, description: s.description, parameters: s.parameters } };
  }

  formatTools(schemas: ToolSchema[]) { return schemas.map(s => this.formatTool(s)); }

  parseToolCall(response: unknown): NormalizedCall[] {
    const calls = (response as { message?: { tool_calls?: OllamaCall[] } })?.message?.tool_calls ?? [];
    return calls
      .filter(c => typeof c?.function?.name === "string")
      .map((c, i) => {
        const rawArgs = c.function?.arguments;
        let args: Record<string, unknown> = {};
        if (typeof rawArgs === "string") {
          try { args = JSON.parse(rawArgs); } catch { args = {}; }
        } else if (rawArgs && typeof rawArgs === "object") {
          args = rawArgs;
        }
        return {
          name: c.function!.name as string,
          arguments: args,
          callId: c.id ?? `ollama_${i}`,
          provider: "ollama" as const,
          raw: c,
        };
      });
  }

  formatToolResult(callId: string, result: unknown) {
    return { role: "tool", tool_call_id: callId, content: JSON.stringify(result) };
  }

  supportsStreaming() { return true; }
  /** Ollama emits tool calls one at a time. */
  supportsParallel() { return false; }
}
