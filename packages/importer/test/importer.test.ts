// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import { describe, it, expect } from "vitest";
import { importOpenAPI, type OpenAPISpec } from "../src/index";

const spec: OpenAPISpec = {
  openapi: "3.1.0",
  info: { title: "Acme API", version: "2.3.1" },
  paths: {
    "/pets/{petId}": {
      get: {
        operationId: "getPet",
        summary: "Fetch a pet",
        parameters: [
          { name: "petId", in: "path", required: true, schema: { type: "string" } },
          { name: "verbose", in: "query", schema: { type: "boolean" } },
        ],
      },
      delete: { description: "Delete a pet" },
    },
    "/pets": {
      post: {
        operationId: "createPet",
        requestBody: { content: { "application/json": { schema: {
          type: "object",
          properties: { name: { type: "string" }, tag: { type: "string" } },
          required: ["name"],
        } } } },
      },
    },
  },
};

describe("importOpenAPI", () => {
  it("produces one manifest per operation", () => {
    const tools = importOpenAPI(spec, { name: "acme" });
    expect(tools.map(t => t.name).sort()).toEqual(["acme/createPet", "acme/delete_pets_petId", "acme/getPet"]);
  });

  it("flattens path, query and body params into inputSchema", () => {
    const getPet = importOpenAPI(spec, { name: "acme" }).find(t => t.name === "acme/getPet")!;
    expect(Object.keys(getPet.inputSchema.properties ?? {})).toEqual(["petId", "verbose"]);
    // path params are runtime-substituted, so they are not required from the model
    expect(getPet.inputSchema.required).toEqual([]);

    const createPet = importOpenAPI(spec, { name: "acme" }).find(t => t.name === "acme/createPet")!;
    expect(Object.keys(createPet.inputSchema.properties ?? {})).toEqual(["name", "tag"]);
    expect(createPet.inputSchema.required).toEqual(["name"]);
  });

  it("maps every provider and takes the spec version", () => {
    const t = importOpenAPI(spec, { name: "acme" })[0];
    expect(t.version).toBe("2.3.1");
    expect(t.providers?.gemini?.function_name).toBeTruthy();
    expect(t.providers?.anthropic?.function_name).toBeTruthy();
    expect(t.enact).toBe("2.0.0");
  });

  it("honours an explicit version override and synthesised action names", () => {
    const t = importOpenAPI(spec, { name: "acme", version: "9.9.9" })[0];
    expect(t.version).toBe("9.9.9");
    expect(importOpenAPI(spec, { name: "acme" }).some(x => x.name.endsWith("delete_pets_petId"))).toBe(true);
  });

  it("rejects non-OpenAPI-3 input and a missing org name", () => {
    expect(() => importOpenAPI({ ...spec, openapi: "2.0" } as OpenAPISpec, { name: "acme" })).toThrow(/3.x/);
    expect(() => importOpenAPI(spec, { name: "" })).toThrow(/org name/);
  });

  it("returns an empty list for a spec with no paths", () => {
    expect(importOpenAPI({ ...spec, paths: {} }, { name: "acme" })).toEqual([]);
  });
});
