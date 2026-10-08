// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import type { ToolManifest, JsonSchema } from "@we-do-care/agentvault-shared";
import { Errors } from "@we-do-care/agentvault-shared";

export interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenAPIOperation>>;
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: JsonSchema }>;
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Turns every OpenAPI 3.x operation into a ToolManifest. Path/query params and
 * the JSON request body are flattened into a single input object schema.
 */
export function importOpenAPI(spec: OpenAPISpec, opts: { name: string; version?: string }): ToolManifest[] {
  if (!spec?.openapi?.startsWith("3.")) throw Errors.validation("only OpenAPI 3.x is supported");
  if (!opts?.name) throw Errors.validation("importer requires an org name (--name)");
  if (!spec.paths) return [];

  const version = opts.version ?? spec.info?.version ?? "0.0.0";
  const tools: ToolManifest[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods ?? {})) {
      if (!METHODS.includes(method as typeof METHODS[number])) continue;
      const action = op.operationId ?? `${method}_${path.replace(/\W+/g, "_").replace(/^_+|_+$/g, "")}`;

      const props: Record<string, unknown> = {};
      const required: string[] = [];

      for (const p of op.parameters ?? []) {
        if (p.in === "path") {
          // path params are substituted by the runtime, not supplied by the model
          props[p.name] = p.schema ?? { type: "string" };
          continue;
        }
        props[p.name] = p.schema ?? { type: "string" };
        if (p.required) required.push(p.name);
      }

      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema?.properties) {
        for (const [k, v] of Object.entries(bodySchema.properties)) props[k] = v;
        if (bodySchema.required) required.push(...bodySchema.required);
      }

      tools.push({
        enact: "2.0.0",
        vault: "1.0.0",
        name: `${opts.name}/${action}`,
        version,
        description: op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`,
        inputSchema: { type: "object", properties: props, required, additionalProperties: false },
        governance: { max_calls_per_minute: 60, allowed_contexts: ["production", "staging", "dev"] },
        providers: {
          gemini:    { function_name: action },
          openai:    { function_name: action },
          anthropic: { function_name: action },
          ollama:    { function_name: action },
        },
      });
    }
  }
  return tools;
}
