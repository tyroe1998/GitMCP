# TypeScript Authenticated MCP Server Scaffold

This is a reference implementation of an authenticated [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server written in TypeScript using the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk). It demonstrates how to expose multiple proprietary data sources to ChatGPT (or any MCP-capable client) through well-defined tools.

The scaffold includes two families of tools you can use as-is or replace with custom integrations:

- **Vector Store Transcript Tools (`search`, `fetch`)** – retrieve documents (in our example, travel-industry expert-call transcripts) from an OpenAI Vector Store. These two tools satisfy the requirements for ChatGPT’s Deep Research workflow. Run `python scripts/upload_expert_calls_to_vector_store.py` from the repository root to create a vector store in your OpenAI workspace using the bundled transcripts and capture the printed `VECTOR_STORE_ID` for your environment.
- **Airfare Trend Tool (`airfare_trend_insights`)** – surface structured airfare pricing and demand data backed by local CSV/TSV/JSON files.

You can swap these example data sources for your own by updating the tool implementations in `src/server.ts`.

---

## Prerequisites

- Node.js 20+
- An Auth0 tenant (or any OAuth 2.1 provider with OIDC discovery)
- An OpenAI API key
- Optional: [ngrok](https://ngrok.com/) (or similar) for tunneling

---

## 1. Install & bootstrap

```bash
git clone https://github.com/openai/openai-mcpkit
cd openai-mcpkit/typescript-authenticated-mcp-server-scaffold
npm install
```

---

## 2. Configure Auth0 authentication

> The scaffold expects OAuth 2.1 bearer tokens issued by Auth0. Substitute your own IdP if you prefer, but keep the same environment variable names.

1. **Create an API**  
   - Auth0 Dashboard → *Applications* → *APIs* → *Create API*  
   - Name it (e.g., `mcp-python-server`)  
   - Identifier → `https://your-domain.example.com/mcp` (add this to your `JWT_AUDIENCES` environment variable)
   - (JWT) Profile → Auth0

2. **Enable a default audience for your tenant** (per [this community post](https://community.auth0.com/t/rfc-8707-implementation-audience-vs-resource/188990/4)) so that Auth0 issues an unencrypted RS256 JWT.
   - Tenant settings > Default Audience > Add the API identifier you created in step 1.
  
3. **Enable Dynamic Client Registration**
   - Go to Dashboard > Settings > Advanced and enable the [OIDC Dynamic Application Registration](https://auth0.com/docs/get-started/applications/dynamic-client-registration?tenant=openai-mcpkit-trial%40prod-us-5&locale=en-us).

4. **Add a social connection to the tenant** for example Google oauth2 to provide a social login mechanism for uers.
   - Authentication > Social > google-oauth2 > Advanced > Promote Connection to Domain Level

5. **Update your environment variables**  
   - `AUTH0_ISSUER`:  your tenant domain (e.g., `https://dev-your-tenant.us.auth0.com/`)
   - `JWT_AUDIENCES`: API identifider created in step 1 (e.g. `https://your-domain.example.com/mcp`)

---

## 3. Environment variables

All configuration is driven by environment variables. Copy the sample file and fill in your values:

```bash
cp .env.example .env
```

### Populate the vector store

From the repository root, run the helper script to create a vector store backed by the bundled expert-call transcripts:

```bash
python scripts/upload_expert_calls_to_vector_store.py
```

The script prints `VECTOR_STORE_ID=...`. Copy that value into your `.env` (or hosting provider configuration) so the server can access the populated vector store.

### Required values (local development)

```
OPENAI_API_KEY=sk-...
VECTOR_STORE_ID=vs_123...

AUTH0_ISSUER=

PORT=8788
RESOURCE_SERVER_URL=
JWT_AUDIENCES=
```

### Additional settings (production deployment)

Once you have deployed the MCP server to a public URL (whether via a tunneling service like ngrok or on a hosting platform, you will need to replace the `RESOURCE_SERVER_URL` with that url.

```
RESOURCE_SERVER_URL=https://your-public-domain.example.com
```

Make sure to set these environment variables in your hosting provider's dashboard (Render, Fly.io, etc.).

The airfare trend tool reads from `synthetic_financial_data/web_search_trends` by default. Update `src/config.ts` if you move or replace the sample data.

---

## 4. Run the server

Use the dev task runner to launch the MCP server:

```bash
npm run dev
```

The server defaults to HTTP streaming transport on `http://localhost:8788`. For production builds you can use:

```bash
npm run start
```

---

## 5. Tool overview

| Tool | Purpose | Backing data | Notes |
| --- | --- | --- | --- |
| `search` | Vector similarity search over expert-call transcripts | OpenAI Vector Store | Meets ChatGPT Deep Research search requirement |
| `fetch` | Retrieve full transcript text by file ID | OpenAI Vector Store | Pairs with `search` to deliver full documents |
| `airfare_trend_insights` | Filterable airfare pricing & load-factor insights | Local CSV/TSV/JSON files (`synthetic_financial_data/web_search_trends`) | Demonstrates how to expose proprietary tabular data |

- The first two tools (`search`, `fetch`) integrate directly with ChatGPT’s Deep Research mode. Provide a `vector_store_id` loaded with your own content to customize the experience.
- `airfare_trend_insights` shows how you can ingest structured files and return filtered results. Feel free to replace it with connections to databases, SaaS APIs, or internal services.

To add or modify tools, edit `src/server.ts`. You can either extend the existing functions or comment them out and implement new ones tailored to your data sources. Helper functions for CSV/JSON ingestion and vector store response handling live in `src/trends.ts`.

---

## 6. Token verification

Authenticated MCP servers must supply a bearer-token verifier. In this scaffold, `verifyBearerToken` in `src/auth.ts` loads signing keys from Auth0’s JWKS endpoint, decodes RS256 tokens using [`jose`](https://github.com/panva/jose), and enforces issuer/audience checks (configure audiences via `JWT_AUDIENCES` in `.env`). Expand the scope checks or add subject-level authorization inside `authenticateRequest` to call user-info endpoints, entitlement services, or custom business logic before processing a request.

If you use Auth0, enable a **default audience** for your tenant (per [this community post](https://community.auth0.com/t/rfc-8707-implementation-audience-vs-resource/188990/4)) so that Auth0 issues an unencrypted RS256 JWT. Without that setting Auth0 returns encrypted (JWE) access tokens that cannot be validated locally.

Some providers (e.g., Okta) expose [RFC 7662 token introspection endpoints](https://developer.okta.com/docs/reference/api/oidc/#introspect-oauth-2-0-access-tokens). In that model your verifier can forward the bearer token to the introspection endpoint and trust the response rather than parsing the JWT locally—replace `verifyBearerToken` with a fetch call that suits your identity provider.

---

## 7. Testing locally with MCP Inspector

1. Ensure the server is running on `http://localhost:8788`.
2. Launch the inspector:

   ```bash
   npx @modelcontextprotocol/inspector@0.16.7
   ```

3. In the Inspector UI:
   - Transport: **HTTP Streaming**
   - URL: `http://localhost:8788/mcp`
   - Click **Connect**. A browser window opens for Auth0’s Universal Login—sign in with a user that has access to the `user` scope.
   - After the Authorization Code + PKCE flow completes, the Inspector reconnects automatically. You can now exercise the `search`, `fetch`, and `airfare_trend_insights` tools.

---

## 8. Expose the server via ngrok (optional)

To test with remote clients (including ChatGPT), tunnel your local port:

```bash
ngrok http 8788
```

Update `RESOURCE_SERVER_URL` with the ngrok url. Re-start the server so it trusts its own externally reachable origin. Share that URL with clients connecting over HTTP streaming.

---

## 9. Connect from ChatGPT (Dev Mode)

1. Make sure that you have [ChatGPT Dev Mode](https://platform.openai.com/docs/guides/developer-mode) enabled.
2. In ChatGPT, enter **Settings → Connectors**.
3. Click **Create**, choose **Custom**, and supply:
   - Name (e.g., “Travel Intelligence MCP”)
   - Endpoint URL (This will be your ngrok URL or production URL if your MCP server is deployed)
   - Authentication: select **OAuth**. When you click **Create**, ChatGPT launches the OAuth 2.1 flow automatically; sign in.
4. After the connector is created, launch Dev Mode to test it. ChatGPT reuses the stored grant and will call `search` + `fetch` automatically inside Deep Research sessions.

---

## 10. Deploying to Render (or similar)

Once you are ready, deploy your MCP server on your cloud hosting service of choice. Some good options are:

- [Render](https://render.com/)
- [Cloudflare](https://www.cloudflare.com/)
- [Vercel](https://vercel.com)

Don't forget to set the environment variables in these hosting platform dashboards and then point the `RESOURCE_SERVER_URL` at the deployed url (with the `/mcp` suffix).

---

## 11. Customize for your own data sources

- **Vector store replacement** – modify `search` and `fetch` in `src/server.ts` to use a different retrieval system (e.g., Azure AI Search, Pinecone) while preserving tool signatures.
- **CSV/Database connectors** – adapt `airfare_trend_insights` and helpers in `src/trends.ts` to read from S3, Snowflake, BigQuery, or internal services.
- **Add/remove tools** – register new functions with `@mcp.tool()` exports in `src/server.ts`. Comment out the sample tools if you only want your own endpoints exposed.
- **Authorization** – extend the logic in `src/auth.ts` to enforce fine-grained entitlements or translate JWT claims into downstream ACL checks.

The scaffold is intentionally straightforward so you can swap components without fighting the framework.

---

Happy building! Swap in your own data sources, tighten authentication, and ship a secure MCP server tailored to your organization’s context. Let us know what you build. 🚀
