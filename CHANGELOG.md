# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Prometheus metrics endpoint (`/metrics`) with HTTP request counters, latency histograms, and tool call tracking
- Dockerfile with multi-stage build, non-root user, and base image digest pinning
- `prom-client` dependency for metrics collection
- Security scanning in CI (trivy for container, npm audit for dependencies)

### Changed
- Updated server to include Prometheus metrics middleware and `/metrics` endpoint
- Hardened Dockerfile: non-root user (UID 1000), base image digest pinning, multi-stage build

### Security
- Added non-root user (UID 1000) in Dockerfile
- Pinned base image digests
- Added security audit steps in CI

## [0.1.3] - 2026-09-30

### Added
- Enterprise Control Plane for AI Tools: governance, secrets lifecycle, multi-provider function calling, telemetry
- Fastify-based API server with health, tools, secrets, policies, execute, audit, telemetry endpoints
- Monorepo structure with 9 packages (shared, core, vault, governance, telemetry, server, cli, adapters, importer)
- SQLite-based persistence with tamper-evident audit ledger
- RBAC with roles: agent, developer, admin, super_admin
- Policy DSL with sliding window rate limiting
- OpenTelemetry-compatible telemetry with SSE live stream
- pnpm workspace with TypeScript, vitest, ESLint

---

**Full Changelog**: https://github.com/we-do-care-global/agentvault/commits/main