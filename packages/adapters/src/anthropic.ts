// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import type { ToolSchema, NormalizedCall } from "@we-do-care/agentvault-shared";
import type { ProviderAdapter } from "./types.js";

interface AnthropicBlock { type?: string; id?: string; name?: string; input?: Record<string, unknown> }

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;

  formatTool(s: ToolSchema) {
    return { name: s.name, description: s.description, input_schema: s.parameters };
  }

  formatTools(schemas: ToolSchema[]) { return schemas.map(s => this.formatTool(s)); }

  parseToolCall(response: unknown): NormalizedCall[] {
    const blocks = (response as { content?: AnthropicBlock[] })?.content ?? [];
    return blocks
      .filter(b => b?.type === "tool_use" && typeof b.name === "string")
      .map(b => ({
        name: b.name as string,
        arguments: b.input ?? {},
        callId: b.id ?? `anthropic_${Math.random().toString(36).slice(2)}`,
        provider: "anthropic" as const,
        raw: b,
      }));
  }

  formatToolResult(callId: string, result: unknown) {
    return { type: "tool_result", tool_use_id: callId, content: JSON.stringify(result) };
  }

  supportsStreaming() { return true; }
  supportsParallel() { return true; }
}
