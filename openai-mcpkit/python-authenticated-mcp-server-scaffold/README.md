# Python Authenticated MCP Server Scaffold

This is a reference implementation of an authenticated [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server written in Python. It demonstrates how to expose multiple proprietary data sources to ChatGPT (or any MCP-capable client) through well-defined tools.

The scaffold includes two families of tools you can use as-is or replace with custom integrations:

- **Vector Store Transcript Tools (`search`, `fetch`)** – retrieve documents (in our example, travel-industry expert-call transcripts) from an OpenAI Vector Store. These two tools satisfy the requirements for ChatGPT’s Deep Research workflow. Run `python scripts/upload_expert_calls_to_vector_store.py` from the repository root to create a vector store in your OpenAI workspace using the bundled expert-call transcripts and capture the printed `VECTOR_STORE_ID` for your environment.
- **Airfare Trend Tool (`airfare_trend_insights`)** – surface structured airfare pricing and demand data backed by local CSV/TSV/JSON files.

You can swap these example data sources for your own by updating the tool implementations in `server/app.py`.

---

## Prerequisites

- Python 3.10+
- An Auth0 tenant (or any OAuth 2.1 provider with OIDC discovery)
- An OpenAI API key
- Optional: [ngrok](https://ngrok.com/) (or similar) for tunneling

---

## 1. Install & bootstrap

```bash
git clone https://github.com/openai/openai-mcpkit
cd openai-mcpkit/python-authenticated-mcp-server-scaffold
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
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
cp env.example .env
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

Set these variables with your hosting provider (Render, Fly.io, etc.).

---

## 4. Run the server

Launch the MCP server using Python’s module runner:

```bash
python -m server.app
```

The server defaults to HTTP streaming transport on `http://localhost:8788`. You can also run it with Uvicorn directly if desired:

```bash
python -m uvicorn server.app:app --host 0.0.0.0 --port 8788
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

To add or modify tools, edit `server/app.py`. You can either extend the existing functions or comment them out and implement new ones tailored to your data sources. Helper functions for CSV/JSON ingestion and vector store response handling live in `server/helpers.py`.

---

## 6. Token verification

Authenticated MCP servers must supply a `TokenVerifier` implementation. To do this, subclass `mcp.server.auth.provider.TokenVerifier`, implement `verify_token`, and return an `AccessToken` object when the incoming bearer token is valid. This scaffold ships with several examples in `server/token_verifiers.py`; in particular, the `JWTVerifier` class shows how to:

- Fetch signing keys from a JWKS URI
- Decode RS256 tokens using [PyJWT](https://pyjwt.readthedocs.io/en/stable/) and enforce issuer/audience checks (configure audiences via `JWT_AUDIENCES` in `.env`)
- Run custom business logic inside `_is_subject_allowed`—that is where you might call OpenID user-info, a permissions service, or your own database to confirm the authenticated identity has access

**Note that the provided implementation of `JWTVerifier` does not contain entitlements, you must add your own entitlements.**

If you use Auth0, enable a **default audience** for your tenant (per [this community post](https://community.auth0.com/t/rfc-8707-implementation-audience-vs-resource/188990/4)) so that Auth0 issues an unencrypted RS256 JWT. Without that setting Auth0 returns encrypted (JWE) access tokens that cannot be validated locally.

Some providers (e.g., Okta) expose [RFC 7662 token introspection endpoints](https://developer.okta.com/docs/reference/api/oidc/#introspect-oauth-2-0-access-tokens). In that model your `TokenVerifier` can simply forward the bearer token to the introspection endpoint and trust the response rather than parsing the JWT locally—the scaffold’s `IntrospectionTokenVerifier` shows the rough shape.

Feel free to replace these examples with whatever verifier best fits your identity provider.

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
   - Click **Connect**. A browser window opens for Auth0’s Universal Login—sign in.
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
   - Endpoint URL (This will be your ngrok URL (with "/mcp" appended) or production URL if your MCP server is deployed)
   - Authentication: select **OAuth**. When you click **Create**, ChatGPT launches the OAuth 2.1 flow automatically; sign in.
4. After the connector is created, launch Dev Mode to test it. ChatGPT reuses the stored grant and will call `search` + `fetch` automatically inside Deep Research sessions.

---

## 10. Deploying the MCP server

Once you are ready, deploy your MCP server on your cloud hosting service of choice. Some good options are:

- [Render](https://render.com/)
- [Cloudflare](https://www.cloudflare.com/)
- [Vercel](https://vercel.com)


## 11. Customize for your own data sources

- **Vector store replacement** – modify `search` and `fetch` to use a different retrieval system (e.g., Azure AI Search, Pinecone) while preserving tool signatures.
- **CSV/Database connectors** – adapt `airfare_trend_insights` to read from S3, Snowflake, BigQuery, or internal services. Use `server/helpers.py` as a starting point for parsing and filtering logic.
- **Add/remove tools** – register new functions with `@mcp.tool()` in `server/app.py`. Comment out the sample tools if you only want your own endpoints exposed.
- **Authorization** – extend `SimpleTokenVerifier` to enforce fine-grained entitlements or translate JWT claims into downstream ACL checks.

The scaffold is intentionally straightforward so you can swap components without fighting the framework.

---

Happy building! Swap in your own data sources, tighten authentication, and ship a secure MCP server tailored to your organization’s context. Let us know what you build. 🚀
