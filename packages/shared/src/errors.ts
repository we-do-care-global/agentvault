// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

export class AgentVaultError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public retryable = false,
  ) {
    super(message);
    this.name = "AgentVaultError";
  }
}

export const Errors = {
  validation: (m: string) => new AgentVaultError("validation_error", m, 400, false),
  auth:       (m: string) => new AgentVaultError("auth_error",       m, 401, false),
  policy:     (m: string) => new AgentVaultError("policy_denied",    m, 403, false),
  provider:   (m: string) => new AgentVaultError("provider_error",   m, 502, true),
  timeout:    (m: string) => new AgentVaultError("timeout",          m, 504, true),
  internal:   (m: string) => new AgentVaultError("internal_error",   m, 500, true),
};
