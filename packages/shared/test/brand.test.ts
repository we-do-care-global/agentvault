// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

import { describe, it, expect } from "vitest";
import { BRAND, LICENSE_HEADER, Errors, AgentVaultError } from "../src/index";

describe("brand system", () => {
  it("keeps org, product, license and version consistent", () => {
    expect(BRAND.org).toBe("We Do Care Global");
    expect(BRAND.product).toBe("AgentVault");
    expect(BRAND.license).toBe("Apache-2.0");
    expect(BRAND.version).toBe('0.1.3');
    expect(BRAND.orcid).toMatch(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/);
  });

  it("uses the WDC gold palette from the seal", () => {
    expect(BRAND.colors.ink).toBe("#0a0b10");
    expect(BRAND.colors.gold).toBe("#d9a95f");
    expect(BRAND.colors.text).toBe("#e8eaf2");
    expect(BRAND.colors.muted).toBe("#8b90a6");
    expect(BRAND.logo).toBe("assets/logo.jpg");
  });

  it("ships a 3-line SPDX header", () => {
    expect(LICENSE_HEADER.split("\n")).toHaveLength(3);
    expect(LICENSE_HEADER).toContain("SPDX-License-Identifier: Apache-2.0");
    expect(LICENSE_HEADER).toContain("We Do Care Global");
    expect(LICENSE_HEADER).toContain("0009-0009-8515-2727");
  });
});

describe("errors", () => {
  it("maps factory helpers to codes and statuses", () => {
    expect(Errors.validation("x").status).toBe(400);
    expect(Errors.auth("x").status).toBe(401);
    expect(Errors.policy("x").status).toBe(403);
    expect(Errors.provider("x").status).toBe(502);
    expect(Errors.timeout("x").status).toBe(504);
    expect(Errors.internal("x").status).toBe(500);
  });

  it("marks transport failures retryable and policy denials not", () => {
    expect(Errors.provider("x").retryable).toBe(true);
    expect(Errors.timeout("x").retryable).toBe(true);
    expect(Errors.policy("x").retryable).toBe(false);
    expect(Errors.validation("x")).toBeInstanceOf(AgentVaultError);
  });
});
