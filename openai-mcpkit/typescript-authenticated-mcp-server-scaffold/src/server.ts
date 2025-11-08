import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';

import { config } from './config.js';
import { authenticateRequest, AuthorizationError, REQUIRED_SCOPES, verifyBearerToken } from './auth.js';
import { collectTextFromContent, queryAirfareTrends } from './trends.js';
import { getOpenAIClient } from './openaiClient.js';

const server = new McpServer({
  name: 'typescript-authenticated-mcp',
  version: '0.1.0',
  instructions:
    'Authenticated MCP server implemented in TypeScript. Provides `search` and `fetch` tools backed by an OpenAI vector store plus `airfare_trend_insights` over CSV/TSV/JSON datasets. Requires Auth0-issued OAuth 2.1 access tokens.'
});

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

const auth0IssuerUrl = new URL(config.auth0Issuer);
const authorizationUrl = new URL('authorize', auth0IssuerUrl).toString();
const tokenUrl = new URL('oauth/token', auth0IssuerUrl).toString();
const revocationUrl = new URL('oauth/revoke', auth0IssuerUrl).toString();
const registrationUrl = new URL('oidc/register', auth0IssuerUrl).toString();

const oauthProvider = new ProxyOAuthServerProvider({
  endpoints: {
    authorizationUrl,
    tokenUrl,
    revocationUrl,
    registrationUrl
  },
  verifyAccessToken: async token => verifyBearerToken(token)
});

oauthProvider.skipLocalPkceValidation = true;

logAuthConfiguration();

app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: auth0IssuerUrl,
    baseUrl: config.resourceServerUrl,
    scopesSupported: REQUIRED_SCOPES
  })
);

function logAuthConfiguration() {
  console.info('[auth] issuer:', auth0IssuerUrl.href);
  console.info('[auth] authorization endpoint:', authorizationUrl);
  console.info('[auth] token endpoint:', tokenUrl);
  console.info('[auth] revocation endpoint:', revocationUrl);
  console.info('[auth] registration endpoint:', registrationUrl);
  console.info('[auth] required scopes:', REQUIRED_SCOPES.join(', ') || '(none)');
}

const vectorStoreId = config.vectorStoreId;

server.registerTool(
  'search',
  {
    title: 'Search Expert Call Transcripts',
    description: 'Semantic search over travel-industry expert call transcripts stored in an OpenAI vector store.',
    inputSchema: {
      query: z.string().describe('Natural language search query. Empty queries return no results.')
    },
    outputSchema: {
      results: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          text: z.string(),
          url: z.string()
        })
      )
    }
  },
  async ({ query }) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      const empty = { results: [] as Array<{ id: string; title: string; text: string; url: string }> };
      return {
        content: [{ type: 'text', text: JSON.stringify(empty) }],
        structuredContent: empty
      };
    }

    if (!vectorStoreId) {
      const error = { error: 'Vector store not configured', detail: 'Set VECTOR_STORE_ID to enable search.' };
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(error) }]
      };
    }

    const openai = getOpenAIClient();

    try {
      const response = await openai.vectorStores.search(vectorStoreId, {
        query: trimmedQuery,
        ranking_options: { score_threshold: 0.5 },
        rewrite_query: true
      } as Record<string, unknown>);

      const data = Array.isArray((response as Record<string, unknown>).data)
        ? ((response as Record<string, unknown>).data as Array<Record<string, unknown>>)
        : [];

      const results = data.map((item, index) => {
        const rawContent = item['content'];
        const text = collectTextFromContent(rawContent);
        const snippet = text.length > 200 ? `${text.slice(0, 200)}...` : text || 'No content available';
        const id = String(item['file_id'] ?? item['id'] ?? `vs_${index}`);
        const title = String(item['filename'] ?? `Document ${index + 1}`);
        return {
          id,
          title,
          text: snippet,
          url: `https://platform.openai.com/storage/files/${id}`
        };
      });

      const payload = { results };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload
      };
    } catch (error) {
      console.error('Vector store search failed', error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'Search failed', detail: message }) }]
      };
    }
  }
);

server.registerTool(
  'fetch',
  {
    title: 'Fetch Transcript',
    description: 'Retrieve the full expert-call transcript text for a given file ID.',
    inputSchema: {
      id: z.string().describe('File ID returned from the search tool.')
    }
  },
  async ({ id }) => {
    if (!vectorStoreId) {
      const error = { error: 'Vector store not configured', detail: 'Set VECTOR_STORE_ID to enable fetch.' };
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(error) }]
      };
    }

    const openai = getOpenAIClient();

    try {
      const contentResponse = await openai.vectorStores.files.content(id, {
        vector_store_id: vectorStoreId
      });

      const data = (contentResponse as Record<string, unknown>)?.data ?? contentResponse;
      const text = collectTextFromContent(data);

      let title = `Document ${id}`;
      let metadata: Record<string, unknown> | undefined;

      try {
        const fileInfo = await openai.vectorStores.files.retrieve(id, {
          vector_store_id: vectorStoreId
        });
        const record = fileInfo as Record<string, unknown>;
        if (typeof record.filename === 'string') {
          title = record.filename;
        }
        if (record.attributes && typeof record.attributes === 'object') {
          metadata = record.attributes as Record<string, unknown>;
        }
      } catch (infoError) {
        console.warn('Failed to fetch vector store file metadata:', infoError);
      }

      const payload = {
        id,
        title,
        text: text || 'No content available.',
        url: `https://platform.openai.com/storage/files/${id}`,
        metadata
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload
      };
    } catch (error) {
      console.error('Vector store fetch failed', error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'Fetch failed', detail: message }) }]
      };
    }
  }
);

const trendInputSchema = {
  snapshotDate: z.string().describe('Exact snapshot date (YYYY-MM-DD)').optional(),
  routeContains: z.string().describe('Substring to match against the route column.').optional(),
  originAirport: z.string().describe('Exact origin airport code.').optional(),
  destinationAirport: z.string().describe('Exact destination airport code.').optional(),
  airlineContains: z.string().describe('Substring to match airlines.').optional(),
  seasonContains: z.string().describe('Substring to match season.').optional(),
  notableContains: z.string().describe('Substring match against notable_event.').optional(),
  limit: z.number().int().min(1).max(200).describe('Maximum number of rows to return (default 25).').optional()
};

server.registerTool(
  'airfare_trend_insights',
  {
    title: 'Airfare Trend Insights',
    description: 'Filter structured airfare pricing and demand trend snapshots from local CSV/TSV/JSON files.',
    inputSchema: trendInputSchema,
    outputSchema: {
      rows: z.array(z.record(z.any())),
      available_files: z.array(z.string()),
      filters: z.record(z.any()),
      total_rows: z.number(),
      matched_rows: z.number(),
      rows_returned: z.number(),
      trend_data_dir: z.string()
    }
  },
  async input => {
    try {
      const payload = await queryAirfareTrends(config.trendDataDir, {
        snapshotDate: input.snapshotDate ?? null,
        routeContains: input.routeContains ?? null,
        originAirport: input.originAirport ?? null,
        destinationAirport: input.destinationAirport ?? null,
        airlineContains: input.airlineContains ?? null,
        seasonContains: input.seasonContains ?? null,
        notableContains: input.notableContains ?? null,
        limit: input.limit ?? null
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload
      };
    } catch (error) {
      console.error('Trend insights tool failed', error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'Trend insights failed', detail: message }) }]
      };
    }
  }
);

app.options('/mcp', (_req, res) => {
  res.status(204).send();
});

app.post('/mcp', async (req, res) => {
  try {
    const authInfo = await authenticateRequest(req);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    await server.connect(transport);

    (req as typeof req & { auth: typeof authInfo }).auth = authInfo;

    res.on('close', () => {
      transport.close().catch(err => console.error('Transport close error', err));
    });

    await transport.handleRequest(req as typeof req & { auth: typeof authInfo }, res, req.body);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      res.status(error.status).json({
        jsonrpc: '2.0',
        error: {
          code: error.status,
          message: error.message
        },
        id: null
      });
      return;
    }
    console.error('Unhandled MCP request error', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error'
      },
      id: null
    });
  }
});

const serverInstance = app.listen(config.port, () => {
  console.info(`MCP server listening on ${config.resourceServerUrl.href}`);
});

process.on('SIGINT', () => {
  console.info('Received SIGINT, shutting down');
  serverInstance.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.info('Received SIGTERM, shutting down');
  serverInstance.close(() => process.exit(0));
});
