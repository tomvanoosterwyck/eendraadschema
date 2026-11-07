# Research: share server integration contract for workspace publish and auth

Ticket: [#12](https://github.com/tomvanoosterwyck/eendraadschema/issues/12) · Researched 2026-11-07

## Question

What is the exact integration contract of the existing Go share server, and what would "workspace → publish" and MCP authentication need from it?

## Method

- Read every route and handler in `server/internal/api/api.go`.
- Read the GORM models and store methods in `server/internal/store/store.go`.
- Read the password/session and OIDC verification code in `server/internal/auth/`.
- Read config defaults in `server/internal/config/config.go` and the root mux in `server/cmd/share-server/main.go`.
- Read the frontend save-to-share flow in `src/importExport/importExport.ts:319-385`.

## Route map

All routes are mounted under `/api` (`server/cmd/share-server/main.go:37-44`). The API router is built in `server/internal/api/api.go:129-143`.

| Method | Path | Handler | Auth | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/healthz` | `handleHealthz` (`:204`) | none | DB health check |
| POST | `/api/shares` | `handleShares` (`:218`) | OIDC bearer, or password/session | Creates a share; requires schema starting with `EDS` or `TXT`; returns `{id, url}` |
| GET | `/api/shares/mine` | `handleMyShares` (`:778`) | OIDC bearer | Lists shares owned by the caller (owner only, limit 200) |
| GET | `/api/shares/{id}` | `handleGetShare` (`:508`) | **public** | Returns `{id, name, schema, updatedAt}` |
| PUT | `/api/shares/{id}` | `handleUpdateShare` (`:522`) | OIDC bearer (owner or team member), or password/session | Updates schema and/or name; last-write-wins |
| DELETE | `/api/shares/{id}` | `handleDeleteShare` (`:342`) | OIDC bearer (owner only) | Deletes share, versions, sessions |
| GET | `/api/shares/{id}/versions` | `handleShareVersions` (`:416`) | OIDC owner/team, or legacy session | Lists versions |
| GET | `/api/shares/{id}/versions/{vid}` | `handleShareVersions` (`:416`) | same | Returns a stored schema |
| POST | `/api/shares/{id}/versions/{vid}/restore` | `handleShareVersions` (`:416`) | same | Restores a version, adds a new version row |
| GET/POST | `/api/teams` | `handleTeams` (`:815`) | OIDC bearer | List teams for user / create team |
| POST | `/api/teams/{id}/invites` | `handleTeamByID` (`:863`) | OIDC bearer, team owner role | Creates a 7-day invite token |
| POST | `/api/invites/accept` | `handleAcceptInvite` (`:922`) | OIDC bearer | Accepts an invite |
| GET | `/api/me` | `handleMe` (`:609`) | OIDC bearer | Returns `sub`, `email`, `name`, `isAdmin` |
| GET | `/api/admin/users` | `handleAdminUsers` (`:631`) | OIDC admin | List/search users |
| PUT | `/api/admin/users/{sub}` | `handleAdminUserBySub` (`:665`) | OIDC admin | Set admin flag |
| GET | `/api/admin/shares` | `handleAdminShares` (`:701`) | OIDC admin | List all shares |
| GET | `/api/admin/shares/{id}` | `handleAdminShareByID` (`:750`) | OIDC admin | Share detail |

`GET /api/shares/{id}` is intentionally public: anyone with the UUID can read the schema. There is no private draft concept.

## Store schema

`server/internal/store/store.go`:

| Table | Model | Key fields |
| --- | --- | --- |
| `users` | `UserModel` (`:19-27`) | `sub` PK, `email`, `name`, `is_admin`, timestamps, `last_seen_at` |
| `shares` | `ShareModel` (`:115-125`) | `id` PK (UUID), `name`, `schema` (opaque text), `owner_sub`, `team_id` (nullable), timestamps |
| `share_versions` | `ShareVersionModel` (`:127-135`) | `id` PK, `share_id`, `schema`, `created_at`, `created_by_sub` |
| `sessions` | `SessionModel` (`:137-144`) | `token` PK, `share_id`, `expires_at`, `created_at` |
| `teams` | `TeamModel` (`:146-153`) | `id` PK, `name`, `owner_sub`, `created_at` |
| `team_members` | `TeamMemberModel` (`:155-162`) | (`team_id`, `user_sub`) PK, `role`, `created_at` |
| `team_invites` | `TeamInviteModel` (`:164-174`) | `token` PK, `team_id`, `email`, `expires_at`, `accepted_*` |

Versioning: each create/update adds a `share_versions` row; old versions are pruned to `EDS_SHARE_SHARE_VERSIONS_MAX` (default 50) (`store.go:459-545`; config `:41-44`).

## Auth behaviour

### OIDC mode

- Enabled when both `EDS_SHARE_OIDC_ISSUER_URL` and `EDS_SHARE_OIDC_CLIENT_ID` are set (`config.go:79-83`; `server/internal/auth/oidc.go:107-150`).
- The server does OIDC discovery at `<issuer>/.well-known/openid-configuration`, caches the JWKS, and verifies JWT access/ID tokens (RS256/ES256) (`oidc.go:62-105,152+`).
- Audience defaults to the client ID, or the comma-separated `EDS_SHARE_OIDC_AUDIENCE` (`config.go:82`; `oidc.go:133-150`).
- The frontend sends `Authorization: Bearer <access token>` (`src/importExport/importExport.ts:341-370`).
- `requireUser` also upserts the OIDC user into `users` on every request (`api.go:38-57`; `store.go:84-113`).
- Bootstrap admins come from `EDS_SHARE_ADMIN_SUBS` (`config.go:46-47`; `api.go:145-156`).

### Legacy password/session mode

- Enabled when OIDC is not configured.
- `requireAuth` accepts either a valid session cookie or the server-wide password (`api.go:79-103`).
- A valid password creates a `sessions` row bound to the share ID being written and sets an HttpOnly cookie (`api.go:92-101`; `auth/auth.go:8-35`).
- Sessions are cleaned up lazily on each `requireAuth` (`api.go:80-82`).
- `canAccessShare` in legacy mode only checks that *any* valid session exists; it does not check that the session belongs to the share (`api.go:404-412`). This is a known isolation gap.

### Share access rules

- Create: OIDC user, or password/session. If `teamId` is supplied, the creator must be a team member (`api.go:255-275`).
- Read: public by UUID (`api.go:508-520`).
- Update: OIDC owner or team member; otherwise password/session (`api.go:522-607`). Last-write-wins.
- Delete: OIDC owner only (`api.go:342-373`).
- Versions: OIDC owner/team member, or legacy session (`api.go:375-414`).

## What the frontend does today

`src/importExport/importExport.ts:319-385`:

- Requires OIDC; otherwise it falls back to a local save.
- Builds `schemaText` with `buildShareSchemaText` (EDS or TXT).
- `POST /api/shares` with `{schema, baseUrl, name}` and bearer token.
- `PUT /api/shares/{id}` with `{schema, name}` and bearer token.
- Stores the returned share ID in `globalThis.currentShareId`.
- Uses `TXT0040000` for the autosave snapshot, not the compressed payload.

## Contract for an MCP service

### Workspace documents

The share server has **no draft/workspace concept**. A workspace document needs its own storage. Recommended:

- A new `workspace_documents` table in the same database (SQLite/Postgres), owned by the MCP service or by the Go server:
  - `id` (UUID), `owner_sub`, `name`, `schema` (canonical `.eds` text or JSON), `revision` (monotonic integer), `created_at`, `updated_at`, `published_share_id` (nullable), `published_revision` (nullable).
- A `workspace_document_versions` table if we want history before publish (optional; the share server already keeps published versions).
- On publish:
  1. If `published_share_id` is null: `POST /api/shares` with the current schema and optional `teamId`; store `published_share_id` and `published_revision`.
  2. If it exists: `PUT /api/shares/{id}` with the current schema; update `published_revision`.
  3. On unpublish: `DELETE /api/shares/{id}` (owner only), then clear `published_share_id`.
- The MCP service should call the API rather than write the `shares` table directly, so auth, team checks, and versioning stay in one place.

### Authentication

- **OIDC:** the MCP service should accept the same bearer token and validate the same issuer/audience. It can reuse `sub` as `owner_sub`. It should also expose MCP protected-resource metadata (`/.well-known/oauth-protected-resource`) pointing at the IdP; the current Go server does not.
- **Password fallback:** accept the existing `EDS_SHARE_PASSWORD` as a bearer token and map it to a single-user workspace. This is a compatibility mode, not an OAuth flow.
- **API tokens:** no table exists. Add a `mcp_api_tokens` table (hashed token, owner_sub, scopes, expiry, revoked_at) in the MCP service or the share DB. Do not reuse `sessions`: it is share-scoped, not user-scoped.
- **stdio:** take a token/workspace from environment variables; do not print it.

### Gaps / risks

1. **No optimistic concurrency.** `UpdateShareFields` has no `If-Match`/revision check (`store.go:391-414`). Two publishes can overwrite each other. Add a revision/updated-at precondition in Go, or do a read-then-check before PUT (racy) and accept the risk for v1.
2. **No workspace/draft model.** Must be added; do not overload `shares` with private documents because `GET` is public.
3. **Legacy session isolation.** `requireAuth` accepts any valid session for any share (`api.go:59-77,79-103`). If password mode is kept, fix this or restrict it to a single-user deployment.
4. **Owner-only delete and list.** Team members can update but cannot delete or list team shares (`/api/shares/mine` is owner-only). Decide whether "unpublish" requires owner and document it.
5. **No team member listing/removal.** Only invites exist (`api.go:815-920`). Not needed for v1 publish, but affects team UX.
6. **Public read.** A published share is public by UUID. The workspace must remain private; only publish intentionally.
7. **Body limit.** `EDS_SHARE_MAX_BODY_BYTES` defaults to 8 MiB (`config.go:66`). Enforce the same limit in the MCP service.
8. **CORS/Origin.** The Go server sets CORS only when `EDS_SHARE_ALLOWED_ORIGIN` is set (`api.go:175-202`). MCP Streamable HTTP requires `Origin` validation; implement it in the MCP service instead of relying on the share server.
9. **No MCP auth metadata.** `/.well-known/oauth-protected-resource` must be served by the MCP service (or proxied).
10. **Schema is opaque.** The share server only checks the `EDS`/`TXT` prefix (`api.go:232-238`). Structural validation must happen in the MCP service before publish.

## Recommendation

- Keep the Go share server as the publishing and OIDC backend; do not fork its auth.
- Add a private workspace store in the MCP service (same DB or its own), with explicit `revision`.
- Publish via the existing `POST`/`PUT`/`DELETE` share API; never write `shares` directly.
- Add revision preconditions to the Go update handler in a follow-up task, or accept last-write-wins explicitly in v1.
- Validate issuer/audience in the MCP service and expose MCP protected-resource metadata; map `sub` to `owner_sub`.
- Add API tokens as a separate table; do not reuse share sessions.
