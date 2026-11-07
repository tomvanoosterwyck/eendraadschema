# Research: current MCP SDK, transport, auth, and packaging options for this stack

Ticket: [#11](https://github.com/tomvanoosterwyck/eendraadschema/issues/11) · Researched 2026-11-07

## Question

What are the current primary-source facts needed to choose an MCP implementation for this repo, and what is the least complicated setup that still supports both local stdio and hosted Streamable HTTP?

## Sources

- MCP specification, transports: <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- MCP specification, authorization: <https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>
- MCP "Build an MCP server": <https://modelcontextprotocol.io/docs/develop/build-server>
- MCP introduction / ecosystem: <https://modelcontextprotocol.io/docs/getting-started/intro>
- TypeScript SDK v2 README: <https://github.com/modelcontextprotocol/typescript-sdk>
- TypeScript SDK v2 docs: <https://ts.sdk.modelcontextprotocol.io/v2/>
- Go SDK README: <https://github.com/modelcontextprotocol/go-sdk>
- Claude Code MCP docs: <https://code.claude.com/docs/en/mcp>
- OpenCode MCP docs: <https://opencode.ai/docs/mcp-servers/>

## Findings

### Transports

MCP currently defines two standard transports (`transports` spec):

1. **stdio** — client launches the server as a subprocess; newline-delimited JSON-RPC on stdin/stdout; logs must go to stderr.
2. **Streamable HTTP** — one HTTP endpoint supporting POST and GET; POST carries JSON-RPC; the server may answer with `application/json` or an SSE stream; sessions use the `Mcp-Session-Id` header; clients send `MCP-Protocol-Version`.

Security requirements from the spec:

- Validate the `Origin` header on all incoming Streamable HTTP connections.
- Bind to localhost when running locally.
- Implement authentication for all connections.

### Protocol version and SDK generations

The current stable SDK line implements the **2026-07-28** specification. The TypeScript SDK has split into v2 packages:

| Package | Current version (2026-11-07) | Purpose |
| --- | --- | --- |
| `@modelcontextprotocol/server` | `2.4.0` | MCP server |
| `@modelcontextprotocol/client` | `2.4.0` | MCP client |
| `@modelcontextprotocol/node` | `2.1.2` | Node.js Streamable HTTP adapter |
| `@modelcontextprotocol/express` | `2.0.2` | Express helpers |
| `@modelcontextprotocol/inspector` | `2.14.0` | Inspector / CLI testing |

The old v1 package is `@modelcontextprotocol/sdk` (`1.32.2` at the time of research). It remains maintained for at least six months after the v2 release (2026-07-27), but new work should target v2. The v2 README explicitly says `@modelcontextprotocol/server` and `@modelcontextprotocol/client` are the stable release line.

The Go SDK is `github.com/modelcontextprotocol/go-sdk`, current `v1.8.0`, and supports 2026-07-28 plus earlier revisions. It provides `mcp.Server`, `mcp.StdioTransport`, Streamable HTTP support, and auth primitives in `.../auth` and `.../oauthex`.

### Server API shape (TypeScript v2)

Minimal stdio server from the official docs:

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

serveStdio(() => {
  const server = new McpServer({ name: 'weather', version: '1.0.0' });

  server.registerTool(
    'get-forecast',
    {
      description: 'Get the weather forecast for a city',
      inputSchema: z.object({ city: z.string() })
    },
    async ({ city }) => ({
      content: [{ type: 'text', text: `Sunny in ${city} all week.` }]
    })
  );

  return server;
});
```

Key points:

- v2 uses `serveStdio(factory)` and negotiates the protocol revision per client; a hand-wired `server.connect(new StdioServerTransport())` only serves 2025-era clients.
- Tool schemas use **Standard Schema**; Zod v4, Valibot, ArkType, etc. are supported.
- The SDK ships middleware adapters for Node HTTP, Express, Fastify, and Hono. `@modelcontextprotocol/node` is the wrapper for `IncomingMessage`/`ServerResponse`.

### Client compatibility

MCP is supported by Claude, ChatGPT, VS Code, Cursor, MCPJam, and others (`modelcontextprotocol.io` intro). Concretely:

- **Claude Code** supports remote HTTP with `claude mcp add --transport http <name> <url>`, local stdio, and OAuth via `/mcp`. Its v2 runtime uses TypeScript SDK 2.x and negotiates the 2026-07-28 revision; the v1 runtime remains selectable with `MCP_SDK_GENERATION=v1`.
- **OpenCode** supports remote Streamable HTTP + OAuth by default (`type: "remote"`), local stdio (`type: "local"`), pre-registered OAuth clients, CIMD, and DCR. Its default protocol is `legacy` (classic `initialize`); set `"protocol": "auto"` or `"2026-07-28"` for the newer revision.
- Claude Desktop and other JSON-config clients commonly support stdio; many newer clients support remote HTTP. A stdio↔HTTP bridge is still useful for the long tail.

**Implication:** a remote Streamable HTTP endpoint plus OAuth covers the mainstream clients. Keep a stdio entry point for local use and for clients that only launch subprocesses.

### Authorization

MCP authorization is optional but expected for HTTP servers (`authorization` spec). When implemented:

- The MCP server is an **OAuth 2.1 resource server**.
- It **MUST** expose OAuth 2.0 Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource`, naming at least one authorization server.
- It **MUST** return `WWW-Authenticate` on 401 so clients can discover the metadata.
- Clients use Authorization Server Metadata (RFC 8414), then either Dynamic Client Registration (RFC 7591), a pre-registered client, or Client ID Metadata Documents (CIMD, supported by OpenCode).
- Clients **MUST** include the `resource` parameter (RFC 8707) in authorization and token requests; the server **MUST** validate the token audience for itself.
- Tokens are sent as `Authorization: Bearer <token>` on every HTTP request; no query-string tokens.
- stdio servers **SHOULD NOT** use this flow; they take credentials from the environment.

This maps cleanly onto the existing OIDC setup, with two caveats:

1. The IdP must expose OAuth/OIDC discovery metadata and issue tokens for the MCP server's audience. If it cannot do RFC 8707 resource indicators, configure a fixed audience and validate it explicitly.
2. If the IdP does not support Dynamic Client Registration, clients need a pre-registered client ID (or CIMD, if the IdP supports it). Document that path; do not assume DCR works.

A password fallback is outside the MCP auth spec but is compatible with the transport: the server can accept `Authorization: Bearer <server-password>` and map it to a single-user workspace. Document it as a compatibility mode, not the recommended one.

### Testing

The official build-server docs recommend the Inspector CLI, including both protocol eras:

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --protocol-era modern --method tools/list
npx @modelcontextprotocol/inspector --cli node build/index.js --protocol-era legacy --method tools/list
```

The Inspector defaults to the `legacy` era. Run both to catch version-negotiation regressions. The SDK docs also cover protocol-level testing (`ts.sdk.modelcontextprotocol.io/v2/testing.html`).

### Packaging and deployment options

| Option | Local effort | Hosted effort | Fit for this repo |
| --- | --- | --- | --- |
| **A. TypeScript v2 core, stdio + Node HTTP hosts** | `npm run mcp` | Node service in Docker | Best: reuses the domain model (see #10) |
| **B. Go SDK in the existing share server** | `go run` | Same binary/image | Cheap deployment, but requires porting the `.eds` model/renderer to Go or a Node sidecar |
| **C. Python SDK** | `uv run` | Python service | No reuse of the TS model; extra runtime |
| **D. Hybrid: Go MCP → TS core sidecar** | Two processes | Two processes | Worst of both; avoid unless Go is forced |

For this repo, **A** is the clear fit: the `.eds` codec, model, validation, BOM, cable lengths, and one-line SVG are TypeScript and portable (see #10). The Go server stays the share/auth backend.

The least complicated hosted shape is **two services in the existing Docker Compose**:

- `share` — the existing Go server (static frontend, `/api`, OIDC, DB).
- `mcp` — the Node service, Streamable HTTP on an internal port, same DB/volume.

Expose `/mcp` through the same public origin (a small reverse-proxy rule in the Go server or a front proxy) so clients configure one URL. For local development, `just dev-mcp` runs the stdio server, and `just dev-all` can optionally start the HTTP service. Local-only users never need the hosted service.

Packaging local stdio as an npm package with a `bin` entry is the lowest-friction option; the Go server does not need to embed Node.

### Auth recommendation for this repo

- **Primary:** OIDC via MCP OAuth 2.1. Expose protected-resource metadata pointing at the existing IdP; validate issuer, audience, and expiry. Reuse the `sub` as the workspace owner.
- **Fallback:** the existing `EDS_SHARE_PASSWORD` as a bearer token, mapping to a single-user workspace, only when OIDC is not configured.
- **Headless clients:** issue long-lived API tokens from the MCP service or the existing admin UI; store hashes, not plaintext. The MCP spec does not define API tokens, so this is an extension with its own scope/expiry model.
- **stdio:** credentials from environment variables (`EDS_MCP_TOKEN`, `EDS_MCP_WORKSPACE`), never from stdout.

### Risks / unknowns

- The 2026-07-28 revision is new; client negotiation differs. Test both `modern` and `legacy` eras.
- CIMD / DCR support varies by IdP. Pre-registered clients are the guaranteed fallback.
- `Origin` validation and localhost binding are mandated; do not ship a permissive development default to production.
- If the Go server reverse-proxies `/mcp`, it must not buffer or break SSE; use `httputil.ReverseProxy` with flushing or a front proxy.
- The TypeScript v2 package names are different from the widely known v1 `@modelcontextprotocol/sdk`; pin versions in `package.json`.

## Recommendation matrix

| Decision | Recommendation |
| --- | --- |
| Language/runtime | TypeScript v2 (`@modelcontextprotocol/server` 2.4.0) + Node 22/24 |
| Local transport | stdio via `serveStdio` |
| Hosted transport | Streamable HTTP via `@modelcontextprotocol/node` |
| Auth | OAuth 2.1 with the existing OIDC IdP; password bearer fallback |
| Bridge | Small local stdio↔HTTP bridge built on `@modelcontextprotocol/client`, distributed as an npm `bin` |
| Testing | Inspector CLI in both protocol eras + SDK protocol tests |
| Deployment | `mcp` service beside `share` in the existing Compose, one public `/mcp` URL |
