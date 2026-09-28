# ConvoKit MCP

Two MCP connections in one TypeScript package:

| Connection | Purpose | Authentication |
| --- | --- | --- |
| **Developer** | Help coding assistants integrate ConvoKit using official SDK, UI, authentication, and REST guides | None |
| **App** | Manage users, tokens, memberships, conversation metadata, and messages in one configured app | App credentials in server environment; separate bearer token for HTTP |

You need only the Developer connection to implement an integration. Add the App connection when your assistant should also configure or manage the app. There is no need for a separate MCP server for each SDK, UI framework, or existing REST API surface.

Both connections can run in one process, or in separate processes using the same package. The implementation uses the official MCP TypeScript SDK v2, supports local stdio and remote Streamable HTTP, and accepts the legacy 2025 MCP initialization exchange.

## Quick start

### Public Developer connection

Connect directly to **https://convokit-mcp.suryadeep.workers.dev/mcp/developer**. No installation or credentials are required.

```bash
codex mcp add convokit_developer --url https://convokit-mcp.suryadeep.workers.dev/mcp/developer
```

Or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.convokit_developer]
url = "https://convokit-mcp.suryadeep.workers.dev/mcp/developer"
```

For Cursor, use [examples/mcp-production.json](examples/mcp-production.json) in `.cursor/mcp.json`. The public setup guide is [convokit.app/docs/mcp](https://convokit.app/docs/mcp); Codex options are documented in the [official MCP guide](https://developers.openai.com/codex/mcp).

### App management from the versioned release

Requires Node.js 22.20 or later. Set your app's `CONVOKIT_CLIENT_ID` and `CONVOKIT_CLIENT_SECRET` in the local MCP process environment. Launch with:

```bash
npx -y github:ConvoKitApp/ConvoKit-MCP#v0.1.0 app
```

The first launch installs dependencies and builds the package. Allow up to two minutes; subsequent launches use npm's cache. The release is distributed from GitHub, not the npm registry.

Codex forwards the secret from the environment that launches it:

```toml
[mcp_servers.convokit_app]
command = "npx"
args = ["-y", "github:ConvoKitApp/ConvoKit-MCP#v0.1.0", "app"]
env_vars = ["CONVOKIT_CLIENT_SECRET"]
startup_timeout_sec = 120

[mcp_servers.convokit_app.env]
CONVOKIT_CLIENT_ID = "your-app-id"
```

The dashboard's **MCP integration** tab provides app-specific Codex and JSON configurations. Keep credentials in a trusted local environment or private config outside source control. App management uses administrator credentials and can delete data; review your assistant's proposed changes.

### Develop from source

```bash
npm ci
npm run build
```

### Local coding assistant

Copy [examples/mcp-local.json](examples/mcp-local.json) into your MCP client's server configuration. Replace `/absolute/path/ConvoKit-MCP` with this package's absolute path. The Developer connection is ready immediately; fill in your app's credentials to enable the App connection. Remove the App entry if you only need guides.

The local commands are:

```bash
node dist/cli.js developer
node dist/cli.js app
```

These speak MCP over stdin/stdout and are launched by your MCP client. Logs go to stderr. The default mode is `developer`.

### HTTP

Start the public Developer server:

```bash
npm start
```

Connect your MCP client to `http://127.0.0.1:3333/mcp/developer`.

To enable the App endpoint, copy `.env.example` to `.env` and set:

```dotenv
CONVOKIT_CLIENT_ID=your-app-id
CONVOKIT_CLIENT_SECRET=your-server-only-secret
CONVOKIT_MCP_APP_TOKEN=your-distinct-random-access-token-at-least-32-characters
```

Generate a new MCP token with:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

Load the environment explicitly:

```bash
node --env-file=.env dist/cli.js http
```

Connect to `http://127.0.0.1:3333/mcp/app` with `Authorization: Bearer <CONVOKIT_MCP_APP_TOKEN>`. The access token authenticates the MCP client; the server uses its separate ConvoKit app credentials for SDK calls. App credentials never appear in tool arguments or connection-info results.

Use [examples/mcp-http.json](examples/mcp-http.json) as a starting point. MCP client configuration formats vary; clients must support custom bearer headers for this App endpoint. This version provides explicit token configuration, not a browser OAuth sign-in flow.

`GET /health` reports whether each connection is enabled. `/mcp/app` is unavailable unless configured. Partial HTTP app configuration fails startup. The public Developer endpoint needs no database or ConvoKit account.

## Developer tools

| Tool | Use |
| --- | --- |
| `list_guides` | List guides and their source URLs; optionally filter by platform |
| `search_docs` | Find relevant documentation sections |
| `get_guide` | Read an introductory section and section index, or select a section |
| `get_code_examples` | Read exact documented snippets, filtered by topic and paginated |
| `get_integration_plan` | Get platform-specific setup steps, guide links, and backend token examples |

Supported platforms: `javascript`, `react`, `vue`, `react-native`, `flutter`, `swift`, and `android`.

All 19 guides are also available as `convokit://docs/<guide-id>` resources. The `integrate_convokit` prompt accepts `platform` and `goal` and prepares a task grounded in the official guides.

Example requests to your assistant:

- “Use ConvoKit to add support chat to this React application.”
- “Find the SwiftUI example for read receipts.”
- “Show the authenticated backend token endpoint and adapt it to our session middleware.”

### Keep documentation current

The checked-in `src/content/guides.json` snapshot is generated by rendering the landing-page documentation to Markdown. Code snippets retain their exact original text; source URLs, snapshot date, and a content hash accompany responses. The snapshot is bundled into both Node and Worker builds; runtime operation does not fetch arbitrary URLs or files.

After documentation changes, run:

```bash
npm run sync:docs
# Or specify another landing-page checkout:
node scripts/sync-docs.mjs /absolute/path/Convokit-LandingPage
```

The refresh command requires that landing-page checkout and its installed dependencies. Building and running the MCP package uses the already bundled snapshot and does not require sibling repositories. Refresh the snapshot when releasing documentation updates.

## App tools

| Tool | Use |
| --- | --- |
| `get_app_connection` | Show the configured public app ID and API endpoint |
| `upsert_user` | Create or synchronize an app user |
| `update_user` / `delete_user` | Update or delete an app user |
| `issue_user_token` | Issue a scoped user JWT for an existing user |
| `update_conversation` / `delete_conversation` | Change metadata or delete a conversation |
| `add_conversation_member` / `remove_conversation_member` | Manage membership and READ / READ_WRITE roles |
| `update_message` / `delete_message` | Edit text or delete a message; edits accept an optional revision |

Operations delegate to the published `ConvoKitServerClient` and use the backend's authorization and tenant checks. Delete operations carry MCP destructive annotations. User token results contain a sensitive, short lived JWT; app secrets and inbound MCP access tokens are never returned. API failures return status and code without echoing raw response bodies.

Upstream calls have a 15-second deadline and reject redirects so app credentials cannot be forwarded to a redirected endpoint.

Each App process is bound to **one app**. Multiple customers should run separate App instances with their own credentials, or use separate local stdio connections. A shared hosted service serving multiple customer apps would additionally need per-customer credential resolution, OAuth consent and scopes, and tenant isolation. This package does not implement account-wide dashboard, billing, end-user chat sessions, or realtime event subscriptions.

`CONVOKIT_API_URL` optionally overrides the managed API endpoint for local testing or self-hosting; the default is the SDK's `https://api.convokit.app`. Tools cannot change the app or endpoint.

## Deploy

One public Developer deployment can serve all integrators. Deploy App instances separately when they use different customer credentials. Two endpoints do not require two repositories or two deployments.

### Public Developer Worker

The production Worker serves only `/mcp/developer` and `/health`. It never imports the App server or has customer app credentials. The documentation is public, so this deployment allows browser CORS from all origins. Long-lived change subscriptions are disabled because the corpus is immutable within a deployment.

```bash
npm run worker:check
npm run worker:dry-run
npm run worker:deploy -- --var RELEASE_SHA:$(git rev-parse HEAD)
node scripts/smoke.mjs https://convokit-mcp.suryadeep.workers.dev/mcp/developer
```

`/health` reports the release commit, version, snapshot date, and source hash. Wrangler uses the configured deployment account; forks should update the account and Worker name before deploying. See [Workers configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) and the [SDK HTTP handler](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md).

### Optional Node HTTP deployment

For an external listener, set `HOST=0.0.0.0` and `CONVOKIT_MCP_ALLOWED_HOSTS` to the hostnames your deployment serves. Put HTTPS in front of the service. Browser callers also require explicit full origins in `CONVOKIT_MCP_ALLOWED_ORIGINS`. Native MCP clients usually send no Origin header.

```bash
docker build -t convokit-mcp .
docker run --rm -p 3333:3333 \
  -e CONVOKIT_MCP_ALLOWED_HOSTS=localhost,127.0.0.1 \
  convokit-mcp
```

The container includes the documentation snapshot. To enable App management, supply the three App environment variables through your deployment's secret configuration. The service defaults to loopback outside Docker and restricts host headers, origins, and request sizes. It does not log request bodies or authorization headers.

## Verification

```bash
npm run validate
```

The tests connect using the official MCP client over HTTP and stdio, cover modern and legacy exchanges, check documentation and code preservation, verify SDK request contracts, and test auth rejection, path encoding, revision forwarding, safe errors, host/origin checks, and body limits. Backend calls are mocked; no live customer data is modified.
