# CODE_OF_CLAUDE.md

This file defines the conventions and expectations for AI-assisted coding in agentvault.

## AI Agent Conventions

### When AI agents (Claude, Codex, etc.) work on this repository:

1. **Follow the existing patterns** — Read existing code before writing new code. Match the style, structure, and conventions already present. This is a TypeScript/pnpm monorepo.

2. **Write tests first** — Every new feature or bug fix must include tests. Target ≥80% coverage.

3. **Run the full CI locally before pushing** — Execute:
   ```bash
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm build
   pnpm test
   pnpm lint
   ```

4. **Update documentation** — If you change behavior, update:
   - `CHANGELOG.md` (under `[Unreleased]`)
   - Relevant docstrings and README sections
   - API docs (OpenAPI/Swagger if added)

5. **Use conventional commits** — Prefix commits with:
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation only
   - `refactor:` code change that neither fixes a bug nor adds a feature
   - `test:` adding or modifying tests
   - `chore:` maintenance (deps, config, etc.)

6. **Security first** — Never commit secrets. Use environment variables for configuration. Run security scans (npm audit, trivy) before merging.

7. **Docker best practices** — When modifying Dockerfile:
   - Use specific base image digests (not tags)
   - Run as non-root user
   - Multi-stage builds for smaller images
   - No secrets in images

8. **Observability** — Add metrics for new endpoints. Use the existing Prometheus counters/histograms in `packages/server/src/app.ts`.

9. **Monorepo conventions** — When adding packages:
   - Follow the `@we-do-care/agentvault-*` naming
   - Export from `dist/index.js` with types
   - Use workspace protocol (`workspace:*`) for internal deps
   - Add `vitest` config for testing

10. **No silent failures** — All errors must be logged and surfaced appropriately. Use the existing `AgentVaultError` class.

## Code Review Checklist for AI Contributions

- [ ] Tests added and passing (≥80% coverage)
- [ ] Linting passes (ESLint)
- [ ] Type checking passes (`tsc -b`)
- [ ] Security scans pass (npm audit, trivy)
- [ ] CHANGELOG.md updated
- [ ] Documentation updated
- [ ] No hardcoded secrets
- [ ] Dockerfile follows best practices
- [ ] Metrics added for new endpoints
- [ ] Conventional commit messages

## Prohibited Patterns

- ❌ `console.log()` for logging (use the Fastify logger)
- ❌ Bare `catch {}` clauses
- ❌ Hardcoded paths, URLs, or credentials
- ❌ Skipping tests to "make CI pass"
- ❌ Adding dependencies without updating pnpm-lock.yaml
- ❌ Modifying generated files (dist/, OpenAPI specs, etc.)
- ❌ Committing directly to `main` (use PRs)
- ❌ Cross-package imports without workspace protocol

## Escalation

If an AI agent encounters ambiguity or conflicting requirements:
1. Stop and ask the human maintainer
2. Document the question in the PR description
3. Do not guess — clarify first

---

**ORCID**: 0009-0009-8515-2727 (Emir Perla)
**Maintainer**: We Do Care Global