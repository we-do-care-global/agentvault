// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import type { ToolSchema, NormalizedCall } from "@we-do-care/agentvault-shared";
import type { ProviderAdapter } from "./types.js";

interface OpenAICall { id?: string; function?: { name?: string; arguments?: string } }

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;

  formatTool(s: ToolSchema) {
    return { type: "function", function: { name: s.name, description: s.description, parameters: s.parameters } };
  }

  formatTools(schemas: ToolSchema[]) { return schemas.map(s => this.formatTool(s)); }

  parseToolCall(response: unknown): NormalizedCall[] {
    const calls =
      (response as { choices?: Array<{ message?: { tool_calls?: OpenAICall[] } }> })
        ?.choices?.[0]?.message?.tool_calls ?? [];
    return calls
      .filter(c => typeof c?.function?.name === "string")
      .map(c => {
        let args: Record<string, unknown> = {};
        try {
          args = c.function?.arguments ? JSON.parse(c.function.arguments) : {};
        } catch {
          args = {}; // malformed arguments must not take down the parse path
        }
        return {
          name: c.function!.name as string,
          arguments: args,
          callId: c.id ?? `openai_${Math.random().toString(36).slice(2)}`,
          provider: "openai" as const,
          raw: c,
        };
      });
  }

  formatToolResult(callId: string, result: unknown) {
    return { role: "tool", tool_call_id: callId, content: JSON.stringify(result) };
  }

  supportsStreaming() { return true; }
  supportsParallel() { return true; }
}
