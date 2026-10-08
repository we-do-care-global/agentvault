// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import type { Role } from "@we-do-care/agentvault-shared";

export type Perm = "registry.read" | "registry.write" | "secrets.read" | "secrets.write" | "execute" | "approve";

export const RBAC: Record<Role, ReadonlySet<Perm>> = {
  agent:       new Set(["registry.read", "secrets.read", "execute"]),
  developer:   new Set(["registry.read", "registry.write", "secrets.read", "secrets.write", "execute"]),
  admin:       new Set(["registry.read", "registry.write", "secrets.read", "secrets.write", "execute", "approve"]),
  super_admin: new Set(["registry.read", "registry.write", "secrets.read", "secrets.write", "execute", "approve"]),
};

export function can(role: Role, perm: Perm): boolean {
  return RBAC[role]?.has(perm) ?? false;
}
