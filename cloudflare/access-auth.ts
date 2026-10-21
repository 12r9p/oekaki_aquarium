/**
 * Cloudflare Access JWT verification for Worker request handlers.
 *
 * Set CF_ACCESS_TEAM_DOMAIN to the HTTPS team-domain origin (or its hostname)
 * and CF_ACCESS_AUD to the Access application's audience tag. Optionally set
 * CF_ACCESS_ROLES_CLAIM to the dot-separated claim path containing role names;
 * it defaults to `roles`.
 */
export interface AccessAuthEnv {
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  CF_ACCESS_ROLES_CLAIM?: string;
}

export interface AccessIdentity {
  subject: string;
  email?: string;
  name?: string;
  issuer: string;
  audience: string[];
  roles: string[];
  expiresAt: number;
}

export class AccessAuthError extends Error {
  readonly status: 401 | 503;

  constructor(status: 401 | 503, message: string) {
    super(message);
    this.name = "AccessAuthError";
    this.status = status;
  }
}

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
  crit?: unknown;
  [key: string]: unknown;
}

interface JwtClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  nbf?: unknown;
  email?: unknown;
  name?: unknown;
  [key: string]: unknown;
}

interface AccessJwk extends JsonWebKey {
  kid?: string;
  key_ops?: string[];
}

interface JsonWebKeySet {
  keys: AccessJwk[];
}

interface CachedKeySet {
  keys: Map<string, AccessJwk>;
  expiresAt: number;
}

const JWT_MAX_LENGTH = 16 * 1024;
const JWKS_MAX_BYTES = 64 * 1024;
const DEFAULT_JWKS_TTL_MS = 5 * 60 * 1000;
const MAX_JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map<string, CachedKeySet>();
const jwksRequests = new Map<string, Promise<CachedKeySet>>();

/**
 * Read and validate the JWT added by Cloudflare Access, then return its
 * cryptographically verified identity. Throws AccessAuthError for all denied
 * or unavailable cases, so callers can fail closed with its status code.
 */
export async function authenticateAccessRequest(
  request: Request,
  env: AccessAuthEnv,
): Promise<AccessIdentity> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw unauthorized();
  return verifyAccessJwt(token, env);
}

/** Verify a compact Cloudflare Access JWT without trusting request headers. */
export async function verifyAccessJwt(
  token: string,
  env: AccessAuthEnv,
): Promise<AccessIdentity> {
  if (typeof token !== "string" || token.length === 0 || token.length > JWT_MAX_LENGTH) {
    throw unauthorized();
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) throw unauthorized();

  const header = parseJwtObject<JwtHeader>(parts[0]);
  const claims = parseJwtObject<JwtClaims>(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 256) {
    throw unauthorized();
  }
  // Critical JOSE extensions require additional processing. This verifier does
  // not implement any, so accepting one could change the token's semantics.
  if (header.crit !== undefined || header.b64 !== undefined) throw unauthorized();

  const { issuer, jwksUrl, audienceTag } = getAccessConfiguration(env);
  const audiences = normalizeAudience(claims.aud);
  const expiresAt = claims.exp;
  const now = Math.floor(Date.now() / 1000);

  if (
    claims.iss !== issuer ||
    !audiences.includes(audienceTag) ||
    typeof claims.sub !== "string" ||
    claims.sub.trim().length === 0 ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    (claims.nbf !== undefined &&
      (typeof claims.nbf !== "number" || !Number.isSafeInteger(claims.nbf) || claims.nbf > now))
  ) {
    throw unauthorized();
  }

  let keySet = await getKeySet(jwksUrl);
  let jwk = keySet.keys.get(header.kid);
  if (!jwk) {
    // Cloudflare may have rotated signing keys while this isolate still has a
    // fresh cache entry. Re-fetch once for an unknown key id, then fail closed.
    keySet = await getKeySet(jwksUrl, true);
    jwk = keySet.keys.get(header.kid);
  }
  if (!jwk) throw unauthorized();

  let signatureValid = false;
  const signature = toArrayBuffer(decodeBase64Url(parts[2]));
  const signedContent = toArrayBuffer(new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signature,
      signedContent,
    );
  } catch {
    // A malformed signing key is an upstream verification failure, not a valid
    // identity. Do not include token or key material in diagnostics.
    throw unavailable();
  }
  if (!signatureValid) throw unauthorized();

  const rolesClaim = getClaimPath(claims, env.CF_ACCESS_ROLES_CLAIM?.trim() || "roles");
  const roles = normalizeRoles(rolesClaim);
  const identity: AccessIdentity = {
    subject: claims.sub,
    issuer,
    audience: audiences,
    roles,
    expiresAt,
  };
  if (typeof claims.email === "string" && claims.email.trim()) identity.email = claims.email;
  if (typeof claims.name === "string" && claims.name.trim()) identity.name = claims.name;
  return identity;
}

function getAccessConfiguration(env: AccessAuthEnv): {
  issuer: string;
  jwksUrl: string;
  audienceTag: string;
} {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audienceTag = env.CF_ACCESS_AUD?.trim();
  if (!teamDomain || !audienceTag) throw unavailable();

  let teamOrigin: URL;
  try {
    teamOrigin = new URL(teamDomain.includes("://") ? teamDomain : `https://${teamDomain}`);
  } catch {
    throw unavailable();
  }
  if (
    teamOrigin.protocol !== "https:" ||
    !teamOrigin.hostname ||
    teamOrigin.username ||
    teamOrigin.password ||
    teamOrigin.port ||
    (teamOrigin.pathname !== "/" && teamOrigin.pathname !== "") ||
    teamOrigin.search ||
    teamOrigin.hash
  ) {
    throw unavailable();
  }

  const issuer = teamOrigin.origin;
  return {
    issuer,
    jwksUrl: `${issuer}/cdn-cgi/access/certs`,
    audienceTag,
  };
}

async function getKeySet(url: string, forceRefresh = false): Promise<CachedKeySet> {
  const now = Date.now();
  const cached = jwksCache.get(url);
  if (!forceRefresh && cached && cached.expiresAt > now) return cached;

  const existingRequest = jwksRequests.get(url);
  if (existingRequest) return existingRequest;

  const request = fetchAndCacheKeySet(url);
  jwksRequests.set(url, request);
  try {
    return await request;
  } finally {
    if (jwksRequests.get(url) === request) jwksRequests.delete(url);
  }
}

async function fetchAndCacheKeySet(url: string): Promise<CachedKeySet> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "OpenAI File Downloader, XaiImageApiFetch/1.0",
      },
      redirect: "error",
    });
  } catch {
    throw unavailable();
  }
  if (!response.ok) throw unavailable();

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > JWKS_MAX_BYTES) throw unavailable();
  const body = await readLimitedText(response, JWKS_MAX_BYTES);

  let jwks: JsonWebKeySet;
  try {
    jwks = JSON.parse(body) as JsonWebKeySet;
  } catch {
    throw unavailable();
  }
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0 || jwks.keys.length > 64) {
    throw unavailable();
  }

  const keys = new Map<string, AccessJwk>();
  const duplicateKids = new Set<string>();
  for (const candidate of jwks.keys) {
    if (
      !candidate ||
      candidate.kty !== "RSA" ||
      typeof candidate.kid !== "string" ||
      !candidate.kid ||
      (candidate.use !== undefined && candidate.use !== "sig") ||
      (candidate.alg !== undefined && candidate.alg !== "RS256") ||
      (candidate.key_ops !== undefined && !candidate.key_ops.includes("verify"))
    ) {
      continue;
    }
    // Duplicate kids are ambiguous. Delete and blacklist them for this set.
    if (duplicateKids.has(candidate.kid)) continue;
    if (keys.has(candidate.kid)) {
      keys.delete(candidate.kid);
      duplicateKids.add(candidate.kid);
      continue;
    }
    keys.set(candidate.kid, candidate);
  }
  if (keys.size === 0) throw unavailable();

  const maxAge = parseMaxAge(response.headers.get("cache-control"));
  const result = {
    keys,
    expiresAt: Date.now() + Math.min(maxAge ?? DEFAULT_JWKS_TTL_MS, MAX_JWKS_TTL_MS),
  };
  jwksCache.set(url, result);
  return result;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AccessAuthError) throw error;
    throw unavailable();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw unavailable();
  }
}

function parseMaxAge(cacheControl: string | null): number | undefined {
  if (!cacheControl) return undefined;
  const match = /(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i.exec(cacheControl);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function parseJwtObject<T extends object>(segment: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(segment)));
  } catch {
    throw unauthorized();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw unauthorized();
  return parsed as T;
}

function decodeBase64Url(segment: string): Uint8Array {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) throw unauthorized();
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  let binary: string;
  try {
    binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    throw unauthorized();
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function normalizeAudience(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 32 &&
    value.every((audience) => typeof audience === "string" && audience.length > 0)
  ) {
    return value as string[];
  }
  throw unauthorized();
}

function getClaimPath(claims: JwtClaims, path: string): unknown {
  const parts = path.split(".");
  if (parts.length === 0 || parts.length > 8 || parts.some((part) => !part || part === "__proto__" || part === "constructor" || part === "prototype")) {
    throw unavailable();
  }
  let value: unknown = claims;
  for (const part of parts) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function normalizeRoles(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) throw unauthorized();
  const roles: string[] = [];
  const seen = new Set<string>();
  for (const role of value) {
    if (typeof role !== "string" || role.trim().length === 0 || role.length > 128) throw unauthorized();
    const normalized = role.trim();
    if (!seen.has(normalized)) {
      roles.push(normalized);
      seen.add(normalized);
    }
  }
  return roles;
}

function unauthorized(): AccessAuthError {
  return new AccessAuthError(401, "Unauthorized");
}

function unavailable(): AccessAuthError {
  return new AccessAuthError(503, "Access identity verification unavailable");
}
