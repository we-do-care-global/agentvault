// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { Errors, type ToolManifest } from "@we-do-care/agentvault-shared";

const JsonSchemaSchema = z.object({ type: z.string() }).passthrough();

const ManifestSchema = z.object({
  enact: z.string(),
  vault: z.string(),
  name: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "name must be org/tool"),
  version: z.string(),
  description: z.string().optional(),
  from: z.string().optional(),
  command: z.string().optional(),
  inputSchema: JsonSchemaSchema,
  outputSchema: JsonSchemaSchema.optional(),
  governance: z.object({
    required_role: z.array(z.string()).optional(),
    max_calls_per_minute: z.number().optional(),
    allowed_contexts: z.array(z.string()).optional(),
  }).optional(),
  secrets: z.array(z.object({
    name: z.string(),
    source: z.string().startsWith("vault://"),
    rotation: z.string().optional(),
    scope: z.string().optional(),
    rotation_hook: z.string().url().optional(),
  })).optional(),
  telemetry: z.object({
    track_latency: z.boolean().optional(),
    track_cost: z.boolean().optional(),
    alert_threshold: z.object({
      latency_ms: z.number().optional(),
      error_rate: z.number().optional(),
    }).optional(),
  }).optional(),
  providers: z.record(z.string(), z.object({ function_name: z.string() })).optional(),
  circuit_breaker: z.object({
    error_threshold: z.number(),
    window_seconds: z.number(),
    open_duration_seconds: z.number(),
  }).optional(),
});

/**
 * Accepts either a bare YAML manifest or an enact.md file with YAML frontmatter.
 * Throws AgentVaultError(validation_error) on any schema violation.
 */
export function parseManifest(raw: string): ToolManifest {
  let yaml = raw;
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) yaml = fm[1];
  let parsed: unknown;
  try {
    parsed = YAML.parse(yaml);
  } catch (e) {
    throw Errors.validation(`manifest is not valid YAML: ${(e as Error).message}`);
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues.map(i => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    throw Errors.validation(`invalid manifest - ${detail}`);
  }
  return result.data as ToolManifest;
}

export function loadManifest(path: string): ToolManifest {
  return parseManifest(readFileSync(path, "utf8"));
}
