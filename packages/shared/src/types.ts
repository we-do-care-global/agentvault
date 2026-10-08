// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

export type Provider = "gemini" | "openai" | "anthropic" | "ollama";
export type Context = "production" | "staging" | "dev";
export type TrustLevel = "Untrusted" | "Low" | "Medium" | "High" | "System";
export type Role = "agent" | "developer" | "admin" | "super_admin";

export interface ToolManifest {
  enact: string;
  vault: string;
  name: string;
  version: string;
  description?: string;
  from?: string;
  command?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  governance?: ToolGovernance;
  secrets?: ToolSecretRef[];
  telemetry?: ToolTelemetry;
  providers?: Partial<Record<Provider, { function_name: string }>>;
  circuit_breaker?: CircuitBreaker;
}

export interface ToolGovernance {
  required_role?: Role[];
  max_calls_per_minute?: number;
  allowed_contexts?: Context[];
}

export interface ToolSecretRef {
  name: string;
  source: string;   // vault://<tenant>/<ns>/<key>
  rotation?: string;
  scope?: string;
  rotation_hook?: string;
}

export interface ToolTelemetry {
  track_latency?: boolean;
  track_cost?: boolean;
  alert_threshold?: { latency_ms?: number; error_rate?: number };
}

export interface CircuitBreaker {
  error_threshold: number;
  window_seconds: number;
  open_duration_seconds: number;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [k: string]: unknown;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface NormalizedCall {
  name: string;
  arguments: Record<string, unknown>;
  callId: string;
  provider: Provider;
  raw: unknown;
}

export interface PolicyRule {
  id: string;
  /** Optional human-facing name; defaults to `id`. Unique per tenant. */
  name?: string;
  match: {
    tool?: string;
    agent_role?: Role[];
    context?: Context[];
  };
  conditions?: {
    max_calls_per_minute?: number;
    max_calls_per_day?: number;
    max_cost_per_day_usd?: number;
    allowed_hours_utc?: string[];
  };
  action: "allow" | "deny" | "approval";
  on_violation?: "deny_with_reason" | "allow_with_warning";
  escalate_to?: string;
  priority?: number;
}
