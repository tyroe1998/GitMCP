import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import type { Request } from 'express';
import { config } from './config.js';

const jwksUri = new URL('.well-known/jwks.json', config.auth0Issuer);
const jwks = createRemoteJWKSet(jwksUri);
export const REQUIRED_SCOPES: string[] = ["openid", "profile", "email"];

export class AuthorizationError extends Error {
  constructor(message: string, public readonly status: number = 401) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

function extractScopes(payload: JWTPayload): string[] {
  const scopeValue = (payload.scope ?? payload.scp) as unknown;
  if (!scopeValue) {
    return [];
  }
  if (typeof scopeValue === 'string') {
    return scopeValue
      .split(/[\s,]+/)
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }
  if (Array.isArray(scopeValue)) {
    return scopeValue
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(item => item.length > 0);
  }
  return [];
}

function ensureRequiredScopes(scopes: string[]) {
  const missing = REQUIRED_SCOPES.filter(scope => !scopes.includes(scope));
  if (missing.length > 0) {
    throw new AuthorizationError(`Missing required scopes: ${missing.join(', ')}`, 403);
  }
}

function tryParseUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function resolveResource(payload: JWTPayload): URL | undefined {
  const aud = payload.aud;
  if (typeof aud === 'string') {
    return tryParseUrl(aud);
  }
  if (Array.isArray(aud)) {
    for (const item of aud) {
      const parsed = tryParseUrl(item);
      if (parsed) {
        return parsed;
      }
    }
  }
  const resource = (payload as Record<string, unknown>).resource;
  if (typeof resource === 'string') {
    return tryParseUrl(resource);
  }
  return undefined;
}

export interface VerifiedAuthInfo extends AuthInfo {
  extra: {
    claims: JWTPayload;
    subject?: string;
  };
}

const audienceOption = (() => {
  if (config.expectedAudiences.length === 0) {
    return undefined;
  }
  if (config.expectedAudiences.length === 1) {
    return config.expectedAudiences[0];
  }
  return config.expectedAudiences;
})();

export async function verifyBearerToken(token: string): Promise<VerifiedAuthInfo> {
  if (!token) {
    throw new AuthorizationError('Missing bearer token');
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.auth0Issuer,
    audience: audienceOption
  });

  const scopes = extractScopes(payload);
  if (REQUIRED_SCOPES.length > 0) {
    ensureRequiredScopes(scopes);
  }

  const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
  const clientId =
    typeof payload.azp === 'string'
      ? payload.azp
      : typeof (payload as Record<string, unknown>).client_id === 'string'
        ? ((payload as Record<string, unknown>).client_id as string)
        : 'unknown_client';

  const expiresAt = typeof payload.exp === 'number' ? payload.exp : undefined;

  const resourceUrl = resolveResource(payload) ?? config.resourceServerUrl;

  return {
    token,
    clientId,
    scopes,
    expiresAt,
    resource: resourceUrl,
    extra: {
      claims: payload,
      subject
    }
  };
}

export async function authenticateRequest(req: Request): Promise<VerifiedAuthInfo> {
  const header = req.headers['authorization'] ?? req.headers['Authorization'];
  if (!header || Array.isArray(header)) {
    throw new AuthorizationError('Missing Authorization header');
  }
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    throw new AuthorizationError('Authorization header must be a Bearer token');
  }
  const token = trimmed.slice('bearer '.length);
  return verifyBearerToken(token);
}

export const auth0JwksUri = jwksUri;
