// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import type { ToolSchema, NormalizedCall, Provider } from "@we-do-care/agentvault-shared";

export interface ProviderAdapter {
  readonly provider: Provider;
  /** Single tool in the provider's wire format. */
  formatTool(schema: ToolSchema): unknown;
  /** Tool list wrapped in whatever envelope the provider expects. */
  formatTools(schemas: ToolSchema[]): unknown;
  /** Vendor response -> one canonical NormalizedCall shape. */
  parseToolCall(response: unknown): NormalizedCall[];
  /** Canonical result -> the provider's tool-result block. */
  formatToolResult(callId: string, result: unknown, fnName?: string): unknown;
  supportsStreaming(): boolean;
  supportsParallel(): boolean;
}
