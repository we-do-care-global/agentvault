// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import type { ToolSchema, NormalizedCall } from "@we-do-care/agentvault-shared";
import type { ProviderAdapter } from "./types.js";

interface GeminiCall { name?: string; args?: Record<string, unknown>; id?: string }

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "gemini" as const;

  formatTool(s: ToolSchema) {
    return { name: s.name, description: s.description, parameters: s.parameters };
  }

  /** Gemini groups tools under a single functionDeclarations envelope. */
  formatTools(schemas: ToolSchema[]) {
    return [{ functionDeclarations: schemas.map(s => this.formatTool(s)) }];
  }

  parseToolCall(response: unknown): NormalizedCall[] {
    const calls = (response as { functionCalls?: GeminiCall[] })?.functionCalls ?? [];
    return calls
      .filter(c => typeof c?.name === "string")
      .map(c => ({
        name: c.name as string,
        arguments: c.args ?? {},
        callId: c.id ?? `gemini_${Math.random().toString(36).slice(2)}`,
        provider: "gemini" as const,
        raw: c,
      }));
  }

  /** functionResponse is keyed by function NAME, not the call id. */
  formatToolResult(callId: string, result: unknown, fnName?: string) {
    return { functionResponse: { name: fnName ?? callId, response: { result } } };
  }

  supportsStreaming() { return true; }
  supportsParallel() { return true; }
}
