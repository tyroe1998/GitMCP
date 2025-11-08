import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  PORT: z.string().optional(),
  RESOURCE_SERVER_URL: z.string().url().optional(),
  AUTH0_ISSUER: z.string().url(),
  JWT_AUDIENCES: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  VECTOR_STORE_ID: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.flatten();
  throw new Error(`Invalid environment configuration. Missing or invalid variables: ${JSON.stringify(formatted.fieldErrors)}`);
}

const raw = parsed.data;

const DEFAULT_PORT = 8788;

const port = Number.parseInt(raw.PORT ?? `${DEFAULT_PORT}`, 10);

if (Number.isNaN(port)) {
  throw new Error('PORT environment variable must be a valid integer');
}

const normalizedIssuer = raw.AUTH0_ISSUER.endsWith('/') ? raw.AUTH0_ISSUER : `${raw.AUTH0_ISSUER}/`;

const defaultTrendDataDir = resolve(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  'synthetic_financial_data',
  'web_search_trends'
);

const resourceServerUrl = raw.RESOURCE_SERVER_URL ?? `http://localhost:${port}`;

const expectedAudiences = (raw.JWT_AUDIENCES ?? '')
  .split(',')
  .map(item => item.trim())
  .filter(item => item.length > 0);

if (expectedAudiences.length === 0) {
  expectedAudiences.push(resourceServerUrl);
}

export const config = {
  port,
  auth0Issuer: normalizedIssuer,
  resourceServerUrl: new URL(resourceServerUrl),
  openAiApiKey: raw.OPENAI_API_KEY,
  vectorStoreId: raw.VECTOR_STORE_ID,
  trendDataDir: defaultTrendDataDir,
  expectedAudiences
};

export type AppConfig = typeof config;
