import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { AccessAuthError, authenticateAccessRequest, type AccessAuthEnv, type AccessIdentity } from "./access-auth";
import { AQUARIUM_COMMAND_RETENTION_MS, AquariumCommandStore, type ClaimResult, type SqlStorageLike } from "./command-store";

interface Env extends AccessAuthEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  AQUARIUM: DurableObjectNamespace<AquariumContainer>;
  AQUARIUM_R2: R2Bucket;
  /** Local-only bridge, active only when AQUARIUM_ORIGIN_MODE is explicitly `local`. */
  AQUARIUM_ORIGIN?: string;
  AQUARIUM_ORIGIN_MODE?: string;
  /** Enables synthetic administrator identity only for loopback local development requests. */
  AQUARIUM_ALLOW_UNTRUSTED_ACCESS?: string;
}

interface WorkerContext { waitUntil(promise: Promise<unknown>): void }

const FORWARD_USER_AGENT = "OpenAI File Downloader, XaiImageApiFetch/1.0";
const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";
const INTERNAL_ACCESS_IDENTITY_HEADER = "X-Aquarium-Access-Identity";
const COMMAND_ID_HEADER = "X-Aquarium-Command-Id";
const AQUARIUM_REVISION_HEADER = "X-Aquarium-Revision";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
const IMMUTABLE_IMAGE = /^\/images\/(?:artwork_[\w-]+\.png|fish_\d+\.png|scene\/[\w-]+\.[a-z0-9]+)$/i;
const LIBRARY_IMAGE = /^\/lib-images\/[\w.-]+\.png$/i;
const IMMUTABLE_TTL_SECONDS = 60 * 60 * 24 * 30;
const COMMAND_REQUEST_BODY_LIMIT = 32 * 1024 * 1024;
const PUBLIC_SCAN_BODY_LIMIT = 12 * 1024 * 1024;
const PUBLIC_RELEASE_BODY_LIMIT = 64 * 1024;
const COMMAND_REPLAY_BODY_LIMIT = 16 * 1024;
const AQUARIUM_SNAPSHOT_LIMIT = 8 * 1024 * 1024;
const COMMAND_ID_CLOCK_SKEW_MS = 5 * 60 * 1000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const APP_ROUTES: Record<string, string> = { "/": "/index.html", "/display": "/display.html", "/controller": "/controller.html", "/guest": "/guest.html", "/manage": "/manage.html" };
const edgeCache = (caches as CacheStorage & { default: Cache }).default;

type PublicApiRateLimitRoute = "scan" | "release" | "state";

const PUBLIC_API_RATE_LIMITS: Record<PublicApiRateLimitRoute, { limit: number; windowMs: number }> = {
  scan: { limit: 30, windowMs: 10 * 60 * 1000 },
  release: { limit: 60, windowMs: 10 * 60 * 1000 },
  state: { limit: 240, windowMs: 60 * 1000 },
};

export default {
  async fetch(request: Request, env: Env, context: WorkerContext): Promise<Response> {
    const url = new URL(request.url);
    const authorizationPath = decodePathForAuthorization(url.pathname);

    const protectedPageRoles = requiredPageRoles(authorizationPath);
    if (protectedPageRoles) {
      const identityResult = await requireIdentity(request, env, protectedPageRoles);
      if (identityResult instanceof Response) return identityResult;
    }

    if (LIBRARY_IMAGE.test(url.pathname) || IMMUTABLE_IMAGE.test(url.pathname)) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return cacheImmutableImage(requestForAquarium(request), env, context);
    }

    if (authorizationPath.startsWith("/api/") || authorizationPath === "/ws") {
      if (authorizationPath === "/ws") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return new Response("WebSocket upgrade required", { status: 426, headers: { "Cache-Control": "no-store" } });
        }
      }
      return routeProtectedApiOrWebSocket(request, env, authorizationPath);
    }

    if (url.pathname === "/health") return routeToAquarium(requestForAquarium(request), env);

    if (url.pathname.startsWith("/lib-images/")) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return routeToAquarium(requestForAquarium(request), env);
    }

    if (url.pathname.startsWith("/images/")) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return routeToAquarium(requestForAquarium(request), env);
    }

    const assetPath = APP_ROUTES[url.pathname];
    const assetRequest = assetPath ? new Request(new URL(`${assetPath}${url.search}`, url.origin), request) : request;
    const asset = await env.ASSETS.fetch(assetRequest);
    if (asset.status === 404) return asset;
    const headers = new Headers(asset.headers);
    const isHtml = Boolean(assetPath) || url.pathname.endsWith(".html") || url.pathname === "/";
    headers.set("Cache-Control", isHtml ? "no-cache" : "public, max-age=31536000, immutable");
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  },
};

/**
 * The Worker is the edge router. One named Durable Object owns the single aquarium
 * container so its in-memory simulation and WebSocket registry have one authority.
 */
async function routeProtectedApiOrWebSocket(request: Request, env: Env, pathname: string): Promise<Response> {
  const isWebSocket = pathname === "/ws";
  const isPublicApi = isPublicVisitorApi(request.method, pathname);
  const isDisplayViewportUpdate = request.method.toUpperCase() === "PUT"
    && /^\/api\/clients\/display:[A-Za-z0-9_-]{1,128}\/viewport$/.test(pathname);
  let identity: AccessIdentity | null;

  try {
    if (isWebSocket || isPublicApi) {
      identity = await optionalIdentity(request, env);
    } else if (isDisplayViewportUpdate) {
      const displayIdentity = await requireIdentity(request, env, ["display", "admin"]);
      if (displayIdentity instanceof Response) return displayIdentity;
      identity = displayIdentity;
    } else {
      const protectedIdentity = await requireIdentity(request, env, ["manage", "admin"]);
      if (protectedIdentity instanceof Response) return protectedIdentity;
      identity = protectedIdentity;
    }
  } catch (error) {
    return authenticationErrorResponse(error);
  }

  const limitState = pathname === "/api/state"
    && request.method === "GET"
    && !hasAnyRole(identity, ["manage", "admin"]);
  return routeToAquarium(requestForAquarium(request, identity), env, limitState);
}

function isPublicVisitorApi(method: string, pathname: string): boolean {
  return getPublicApiRateLimitRoute(method, pathname) !== null;
}

function getPublicApiRateLimitRoute(method: string, pathname: string): PublicApiRateLimitRoute | null {
  if (method.toUpperCase() === "POST" && pathname === "/api/scan") return "scan";
  if (method.toUpperCase() === "POST" && pathname === "/api/release") return "release";
  if (method.toUpperCase() === "GET" && pathname === "/api/state") return "state";
  return null;
}

async function hashRateLimitIp(ipHeader: string | null): Promise<string> {
  const candidate = ipHeader?.trim().toLowerCase() ?? "";
  const ip = candidate.length > 0 && candidate.length <= 128 ? candidate : "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  const retryAfter = String(Math.max(1, Math.ceil(retryAfterSeconds)));
  return Response.json(
    { error: "rate_limit_exceeded", retryAfterSeconds: Number(retryAfter) },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": retryAfter } },
  );
}

function requiredPageRoles(pathname: string): string[] | null {
  if (isPagePath(pathname, "/display")) return ["display", "admin"];
  if (isPagePath(pathname, "/manage") || isPagePath(pathname, "/controller")) return ["manage", "admin"];
  return null;
}

function isPagePath(pathname: string, base: string): boolean {
  return pathname === base || pathname === `${base}.html` || pathname.startsWith(`${base}/`);
}

function decodePathForAuthorization(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

async function requireIdentity(
  request: Request,
  env: Env,
  allowedRoles: string[],
): Promise<AccessIdentity | Response> {
  try {
    const localIdentity = getLocalDevelopmentIdentity(request, env);
    if (localIdentity) return hasAnyRole(localIdentity, allowedRoles) ? localIdentity : forbiddenResponse();
    const identity = await authenticateAccessRequest(request, env);
    return hasAnyRole(identity, allowedRoles) ? identity : forbiddenResponse();
  } catch (error) {
    return authenticationErrorResponse(error);
  }
}

async function optionalIdentity(request: Request, env: Env): Promise<AccessIdentity | null> {
  const localIdentity = getLocalDevelopmentIdentity(request, env);
  if (localIdentity) return localIdentity;
  if (!request.headers.get(ACCESS_ASSERTION_HEADER)) return null;
  return authenticateAccessRequest(request, env);
}

function getLocalDevelopmentIdentity(request: Request, env: Env): AccessIdentity | null {
  if (env.AQUARIUM_ALLOW_UNTRUSTED_ACCESS !== "true") return null;
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!LOOPBACK_HOSTS.has(hostname)) return null;
  return {
    subject: "local-development",
    issuer: "local-development",
    audience: ["local-development"],
    roles: ["admin", "display", "manage"],
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

function isUnsafeApiCommand(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  let pathname = new URL(request.url).pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Treat undecodable API-looking paths as commands; the upstream still
    // decides whether the path itself is valid.
  }
  return pathname.startsWith("/api/");
}

function getCommandId(headers: Headers): string | null {
  const commandHeader = headers.get(COMMAND_ID_HEADER)?.trim();
  const idempotencyHeader = headers.get(IDEMPOTENCY_KEY_HEADER)?.trim();
  if (commandHeader && idempotencyHeader && commandHeader !== idempotencyHeader) return null;
  const supplied = commandHeader || idempotencyHeader;
  if (!supplied) return null;
  const match = /^cmd_([0-9a-z]{1,12})_([a-z0-9-]{8,128})$/i.exec(supplied);
  if (!match) return null;
  const issuedAt = Number.parseInt(match[1], 36);
  const now = Date.now();
  // Reserve the accepted clock skew from the age window so receipt cleanup cannot precede ID expiry.
  if (
    !Number.isSafeInteger(issuedAt)
    || issuedAt > now + COMMAND_ID_CLOCK_SKEW_MS
    || now - issuedAt > AQUARIUM_COMMAND_RETENTION_MS - COMMAND_ID_CLOCK_SKEW_MS
  ) return null;
  return supplied;
}

function getCommandActor(headers: Headers): { actorId: string; roles: string[] } | null {
  const encoded = headers.get(INTERNAL_ACCESS_IDENTITY_HEADER);
  if (!encoded) return { actorId: "anonymous", roles: [] };
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const identity = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Partial<AccessIdentity>;
    if (
      typeof identity.subject !== "string" ||
      !identity.subject.trim() ||
      !Array.isArray(identity.roles) ||
      identity.roles.some((role) => typeof role !== "string")
    ) return null;
    return { actorId: identity.subject, roles: [...new Set(identity.roles)] };
  } catch {
    return null;
  }
}

async function readRequestBody(request: Request, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new RequestBodyTooLargeError();
  const stream = request.clone().body;
  if (!stream) return new Uint8Array();

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function hashCommandRequest(request: Request, body: Uint8Array): Promise<string> {
  const url = new URL(request.url);
  const requestMetadata = new TextEncoder().encode(JSON.stringify({
    method: request.method.toUpperCase(),
    path: `${url.pathname}${url.search}`,
    contentType: request.headers.get("content-type") ?? "",
  }));
  const bytes = new Uint8Array(requestMetadata.byteLength + body.byteLength);
  bytes.set(requestMetadata);
  bytes.set(body, requestMetadata.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getReplayableJsonBody(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!(contentType === "application/json" || contentType.endsWith("+json"))) return null;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > COMMAND_REPLAY_BODY_LIMIT) return null;
  const stream = response.clone().body;
  if (!stream) return null;

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > COMMAND_REPLAY_BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    JSON.parse(body);
    return body;
  } catch {
    return null;
  }
}

function commandClaimResponse(claim: Exclude<ClaimResult, { kind: "accepted" }>, commandId: string): Response {
  if (claim.kind === "replay") {
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (claim.contentType) headers.set("Content-Type", claim.contentType);
    return withCommandHeaders(new Response(claim.body, { status: claim.status, headers }), commandId, claim.revision, true);
  }

  const error = claim.kind === "result_unavailable"
    ? "result_unavailable"
    : claim.kind === "in_progress"
      ? "command_in_progress"
      : claim.kind === "capacity_exceeded"
        ? "command_capacity_reached"
        : "command_conflict";
  const status = claim.kind === "in_progress" ? 425 : claim.kind === "capacity_exceeded" ? 503 : 409;
  const response = commandErrorResponse(error, status, commandId, claim.revision);
  if (claim.kind !== "capacity_exceeded") return response;
  const headers = new Headers(response.headers);
  headers.set("Retry-After", "60");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function commandErrorResponse(error: string, status: number, commandId: string, revision: number): Response {
  return withCommandHeaders(
    Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }),
    commandId,
    revision,
    false,
  );
}

function withCommandHeaders(response: Response, commandId: string, revision: number, replayed: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set(COMMAND_ID_HEADER, commandId);
  headers.set("X-Aquarium-Revision", String(revision));
  headers.set("X-Aquarium-Command-Replayed", String(replayed));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function withRevisionHeader(response: Response, revision: number): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Aquarium-Revision", String(revision));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

class RequestBodyTooLargeError extends Error {}

function hasAnyRole(identity: AccessIdentity | null, roles: string[]): boolean {
  return Boolean(identity && identity.roles.some((role) => roles.includes(role)));
}

function requestForAquarium(request: Request, identity?: AccessIdentity | null): Request {
  const headers = new Headers(request.headers);
  stripClientAccessHeaders(headers);
  if (identity) headers.set(INTERNAL_ACCESS_IDENTITY_HEADER, encodeIdentity(identity));
  return new Request(request, { headers });
}

function stripClientAccessHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    const normalized = name.toLowerCase();
    if (
      normalized === ACCESS_ASSERTION_HEADER.toLowerCase() ||
      normalized === "x-aquarium-role" ||
      normalized.startsWith("x-aquarium-access-")
    ) {
      headers.delete(name);
    }
  }
}

function encodeIdentity(identity: AccessIdentity): string {
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function authenticationErrorResponse(error: unknown): Response {
  const status = error instanceof AccessAuthError ? error.status : 503;
  const message = status === 401 ? "Unauthorized" : "Access identity verification unavailable";
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function forbiddenResponse(): Response {
  return Response.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

function methodNotAllowed(allowed: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: allowed, "Cache-Control": "no-store" } });
}

function getLocalAquariumOrigin(env: Env): string | null {
  if (!env.AQUARIUM_ORIGIN || env.AQUARIUM_ORIGIN_MODE !== "local") return null;
  try {
    const origin = new URL(env.AQUARIUM_ORIGIN);
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      !localHosts.has(origin.hostname.toLowerCase()) ||
      origin.username ||
      origin.password ||
      (origin.pathname !== "/" && origin.pathname !== "") ||
      origin.search ||
      origin.hash
    ) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

async function publicStateResponse(response: Response): Promise<Response> {
  if (!response.ok) {
    return Response.json({ error: "Aquarium state unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const state = await response.json() as { activeFish?: unknown };
    if (!Array.isArray(state.activeFish)) throw new Error("Invalid public state");
    const headers = new Headers({ "Cache-Control": "no-store" });
    const revision = response.headers.get("X-Aquarium-Revision");
    if (revision && /^\d+$/.test(revision)) headers.set("X-Aquarium-Revision", revision);
    return Response.json({ activeFish: state.activeFish }, { headers });
  } catch {
    return Response.json({ error: "Aquarium state unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

async function routeToAquarium(request: Request, env: Env, limitState = false): Promise<Response> {
  const localOrigin = getLocalAquariumOrigin(env);
  if (localOrigin) {
    const response = await proxyApi(request, localOrigin);
    return limitState ? publicStateResponse(response) : response;
  }
  if (!env.AQUARIUM) return Response.json({ error: "Aquarium Container binding is missing" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const response = await env.AQUARIUM.getByName("main").fetch(request);
  if (response.status === 101) return response;
  if (limitState) return publicStateResponse(response);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function proxyApi(request: Request, origin: string): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const destination = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, origin);
  const headers = new Headers(request.headers);
  headers.delete(ACCESS_ASSERTION_HEADER);
  headers.set("User-Agent", FORWARD_USER_AGENT);
  headers.set("X-Forwarded-Proto", sourceUrl.protocol.slice(0, -1));
  const response = await fetch(new Request(destination, { method: request.method, headers, body: request.body, redirect: "manual" }));
  if (response.status === 101) return response;
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
}

async function cacheImmutableImage(request: Request, env: Env, context: WorkerContext): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const url = new URL(request.url);
  if (getLocalAquariumOrigin(env)) return routeToAquarium(request, env);

  const key = imageObjectKey(url.pathname);
  if (!key) return new Response("Not Found", { status: 404 });
  const cacheKey = new Request(`${url.origin}${url.pathname}`);
  const cached = await edgeCache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-Aquarium-Edge-Cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers });
  }

  const object = await env.AQUARIUM_R2.get(key);
  if (!object) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", imageContentType(key));
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", `public, max-age=${IMMUTABLE_TTL_SECONDS}, immutable`);
  headers.set("CDN-Cache-Control", `public, max-age=${IMMUTABLE_TTL_SECONDS}, immutable`);
  headers.set("X-Aquarium-Edge-Cache", "MISS");
  const result = new Response(object.body, { headers });
  context.waitUntil(edgeCache.put(cacheKey, result.clone()));
  return result;
}

function imageObjectKey(pathname: string): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (LIBRARY_IMAGE.test(decodedPath)) {
    return `data/fish/${decodedPath.slice("/lib-images/".length)}`;
  }
  if (IMMUTABLE_IMAGE.test(decodedPath)) {
    return `public${decodedPath}`;
  }
  return null;
}

function imageContentType(key: string): string {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return "image/png";
}

export class AquariumContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private readyUntil = 0;
  private restorationNeeded = false;
  private commandStore: AquariumCommandStore | undefined;
  private commandQueue: Promise<void> = Promise.resolve();

  async fetch(request: Request): Promise<Response> {
    const publicRateLimitRoute = getPublicApiRateLimitRoute(
      request.method,
      decodePathForAuthorization(new URL(request.url).pathname),
    );
    if (publicRateLimitRoute) {
      const policy = PUBLIC_API_RATE_LIMITS[publicRateLimitRoute];
      let ipHash: string;
      try {
        ipHash = await hashRateLimitIp(request.headers.get("CF-Connecting-IP"));
      } catch {
        return Response.json({ error: "rate_limit_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
      }
      const decision = this.getCommandStore().consumePublicRateLimit(
        publicRateLimitRoute,
        ipHash,
        policy.limit,
        policy.windowMs,
      );
      if (!decision.allowed) return rateLimitedResponse(decision.retryAfterSeconds);
    }

    if (isUnsafeApiCommand(request)) {
      const command = this.serializeCommand(() => this.handleApiCommand(request));
      this.commandQueue = command.then(() => undefined, () => undefined);
      return command;
    }
    const response = await this.forwardToContainer(request);
    if (request.method === "GET" && new URL(request.url).pathname === "/api/state" && response.status !== 101) {
      return withRevisionHeader(response, this.getCommandStore().getRevision());
    }
    return response;
  }

  private serializeCommand<T>(operation: () => Promise<T>): Promise<T> {
    return this.commandQueue.then(operation, operation);
  }

  private async handleApiCommand(request: Request): Promise<Response> {
    const commandId = getCommandId(request.headers);
    if (!commandId) return Response.json({ error: "invalid_command_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });

    const actor = getCommandActor(request.headers);
    if (!actor) return commandErrorResponse("invalid_access_identity", 401, commandId, this.getCommandStore().getRevision());

    let body: Uint8Array;
    try {
      const pathname = decodePathForAuthorization(new URL(request.url).pathname);
      const publicRoute = getPublicApiRateLimitRoute(request.method, pathname);
      const bodyLimit = publicRoute === "scan"
        ? PUBLIC_SCAN_BODY_LIMIT
        : publicRoute === "release"
          ? PUBLIC_RELEASE_BODY_LIMIT
          : COMMAND_REQUEST_BODY_LIMIT;
      body = await readRequestBody(request, bodyLimit);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return commandErrorResponse("request_body_too_large", 413, commandId, this.getCommandStore().getRevision());
      }
      return commandErrorResponse("request_body_unavailable", 400, commandId, this.getCommandStore().getRevision());
    }

    const url = new URL(request.url);
    const requestHash = await hashCommandRequest(request, body);
    const commandStore = this.getCommandStore();
    try {
      await this.ensureContainerStarted();
    } catch (error) {
      console.error("[AquariumContainer] Container startup failed before command claim:", error);
      return commandErrorResponse("container_starting", 503, commandId, commandStore.getRevision());
    }
    const claim = commandStore.claim({
      commandId,
      method: request.method.toUpperCase(),
      path: url.pathname,
      requestHash,
      actorId: actor.actorId,
      actorRoles: actor.roles,
    });
    if (claim.kind !== "accepted") return commandClaimResponse(claim, commandId);

    const headers = new Headers(request.headers);
    headers.set(COMMAND_ID_HEADER, commandId);
    const forwardedBody = new ArrayBuffer(body.byteLength);
    new Uint8Array(forwardedBody).set(body);
    const upstreamRequest = new Request(request, { headers, body: body.byteLength > 0 ? forwardedBody : null });
    let response: Response;
    try {
      response = await this.forwardToContainer(upstreamRequest, commandId, commandStore.getRevision() + 1);
    } catch {
      // The upstream may have applied the command before the connection failed.
      // Keep the pending claim so a retry cannot accidentally execute it twice.
      try {
        commandStore.markStateUncertain();
      } catch (error) {
        console.error("[AquariumContainer] Could not record uncertain command state:", error);
      }
      return commandErrorResponse("command_result_unknown", 502, commandId, commandStore.getRevision());
    }

    const contentType = response.headers.get("content-type");
    const replayBody = response.status === 204 || response.status === 205
      ? ""
      : await getReplayableJsonBody(response);
    let snapshotJson: string | undefined;
    if (response.status >= 200 && response.status < 300) {
      try {
        snapshotJson = await this.readContainerSnapshot();
      } catch (error) {
        console.error("[AquariumContainer] Could not checkpoint a successful command:", error);
        try {
          commandStore.markStateUncertain();
        } catch (storeError) {
          console.error("[AquariumContainer] Could not record uncertain command state:", storeError);
        }
        return commandErrorResponse("command_result_unknown", 503, commandId, commandStore.getRevision());
      }
    }
    try {
      const revision = commandStore.complete(
        commandId,
        response.status,
        replayBody,
        replayBody === null ? null : contentType,
        snapshotJson,
      );
      return withCommandHeaders(response, commandId, revision, false);
    } catch (error) {
      console.error("[AquariumContainer] Could not record the command result:", error);
      try {
        commandStore.markStateUncertain();
      } catch (storeError) {
        console.error("[AquariumContainer] Could not record uncertain command state:", storeError);
      }
      return commandErrorResponse("command_result_unknown", 503, commandId, commandStore.getRevision());
    }
  }

  private async readContainerSnapshot(): Promise<string> {
    const response = await this.forwardToContainer(new Request("https://aquarium.internal/__internal/snapshot"));
    if (!response.ok) throw new Error(`Snapshot endpoint returned ${response.status}`);
    const snapshotJson = await response.text();
    if (new TextEncoder().encode(snapshotJson).byteLength > AQUARIUM_SNAPSHOT_LIMIT) {
      throw new Error("Snapshot exceeds the SQLite storage limit");
    }
    const snapshot = JSON.parse(snapshotJson) as { schemaVersion?: unknown; savedAt?: unknown };
    if (snapshot.schemaVersion !== 1 || typeof snapshot.savedAt !== "number" || !Number.isFinite(snapshot.savedAt)) {
      throw new Error("Snapshot envelope is invalid");
    }
    return snapshotJson;
  }

  private getCommandStore(): AquariumCommandStore {
    this.commandStore ??= new AquariumCommandStore(this.ctx.storage.sql as unknown as SqlStorageLike);
    return this.commandStore;
  }

  private async forwardToContainer(
    request: Request,
    restoreCommandId?: string,
    upstreamRevision = this.getCommandStore().getRevision(),
  ): Promise<Response> {
    const container = this.ctx.container;
    if (!container) return new Response("Container binding is unavailable", { status: 503 });

    try {
      await this.ensureContainerStarted(restoreCommandId);
    } catch (error) {
      console.error("[AquariumContainer] Container startup failed:", error);
      return new Response("Aquarium runtime is starting; retry shortly", { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store" } });
    }

    const upstreamUrl = new URL(request.url);
    upstreamUrl.protocol = "http:";
    upstreamUrl.host = "container";
    const baseRequest = new Request(upstreamUrl, request);
    const headers = new Headers(baseRequest.headers);
    // Never trust a client-provided revision. The DO is the sole revision authority.
    headers.set(AQUARIUM_REVISION_HEADER, String(upstreamRevision));
    const forwarded = new Request(baseRequest, { headers });
    forwarded.headers.delete("host");
    // The raw network address is needed only to select the SQLite rate-limit bucket.
    forwarded.headers.delete("CF-Connecting-IP");
    forwarded.headers.set("User-Agent", FORWARD_USER_AGENT);
    try {
      return await container.getTcpPort(3000).fetch(forwarded);
    } catch (error) {
      this.readyUntil = 0;
      throw error;
    }
  }

  private async ensureContainerStarted(restoreCommandId?: string): Promise<void> {
    if (!this.ctx.container) throw new Error("Container binding is unavailable");
    if (Date.now() > this.readyUntil) {
      this.starting ??= this.startAndWaitForPort(restoreCommandId).finally(() => {
        this.starting = undefined;
      });
      await this.starting;
      this.readyUntil = Date.now() + 5_000;
    }
  }

  private async startAndWaitForPort(restoreCommandId?: string): Promise<void> {
    const container = this.ctx.container!;
    const r2Bridge = this.ctx.exports.AquariumR2Bridge({ props: {} });
    await container.interceptOutboundHttp("aquarium-r2.internal", r2Bridge);
    if (!container.running) {
      this.restorationNeeded = true;
      container.start({
        image: container.images.base,
        instance: "standard-1",
        enableInternet: true,
        env: {
          PORT: "3000",
          R2_BRIDGE_ORIGIN: "http://aquarium-r2.internal",
        },
      });
      this.ctx.waitUntil(container.monitor().then(
        () => {
          this.readyUntil = 0;
          this.restorationNeeded = true;
          console.error("[AquariumContainer] Container exited.");
        },
        (error) => {
          this.readyUntil = 0;
          this.restorationNeeded = true;
          console.error("[AquariumContainer] Container exited with an error:", error);
        },
      ));
    }
    await container.setInactivityTimeout(10 * 60 * 1000);
    const port = container.getTcpPort(3000);
    let healthy = false;
    for (let attempt = 0; attempt < 240; attempt++) {
      try {
        const response = await port.fetch(new Request("http://container/health", {
          headers: { "User-Agent": FORWARD_USER_AGENT },
          signal: AbortSignal.timeout(1_000),
        }));
        await response.body?.cancel();
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        // The container process has started but Bun has not bound its HTTP port yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!healthy) throw new Error("Container did not become ready on port 3000");

    if (this.restorationNeeded) {
      await this.restoreStoredSnapshot(restoreCommandId);
      this.restorationNeeded = false;
    }
  }

  private async restoreStoredSnapshot(restoreCommandId?: string): Promise<void> {
    const commandStore = this.getCommandStore();
    if (commandStore.isStateUncertain(restoreCommandId)) {
      // Do not let the Container's legacy R2 boot restore silently become the authority.
      // Keep the runtime unavailable until the ambiguous mutation is reconciled.
      throw new Error("Aquarium state is uncertain; refusing to serve the Container's R2 fallback");
    }
    const snapshot = commandStore.getSnapshot();
    if (!snapshot) {
      if (commandStore.isInitialized()) {
        throw new Error("Aquarium DO is marked initialized but has no canonical snapshot");
      }
      // One-time migration: the freshly started Container has loaded the legacy R2 state.
      // Persist that complete state in SQLite before allowing network traffic to continue.
      const initialSnapshotJson = await this.readContainerSnapshot();
      if (commandStore.seedSnapshot(initialSnapshotJson)) {
        console.info("[AquariumContainer] Seeded the authoritative SQLite aquarium snapshot from the legacy R2 restore.");
        return;
      }
      // Another awaited initialization may have populated SQLite first; restore that winner.
      return this.restoreStoredSnapshot(restoreCommandId);
    }
    const revision = commandStore.getRevision();
    if (snapshot.revision !== revision) {
      throw new Error(`Stored aquarium snapshot does not match the committed revision (${snapshot.revision} != ${revision})`);
    }
    const response = await this.ctx.container!.getTcpPort(3000).fetch(new Request("http://container/__internal/snapshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": FORWARD_USER_AGENT,
      },
      body: snapshot.json,
      signal: AbortSignal.timeout(10_000),
    }));
    if (!response.ok) throw new Error(`Container snapshot restore returned ${response.status}`);
    await response.body?.cancel();
  }
}

/** Internal R2 gateway used by the Container through an outbound HTTP intercept. */
export class AquariumR2Bridge extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/__list") {
      const prefix = url.searchParams.get("prefix") ?? "";
      if (!isPersistedPrefix(prefix)) return new Response("Invalid R2 prefix", { status: 400 });
      const cursor = url.searchParams.get("cursor") ?? undefined;
      const page = await this.env.AQUARIUM_R2.list({ prefix, cursor, limit: 1000 });
      return Response.json({
        keys: page.objects.map((object) => object.key),
        cursor: page.truncated ? page.cursor : null,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (!url.pathname.startsWith("/object/")) return new Response("Not found", { status: 404 });
    let key: string;
    try {
      key = url.pathname.slice("/object/".length).split("/").map(decodeURIComponent).join("/");
    } catch {
      return new Response("Invalid object key", { status: 400 });
    }
    if (!isPersistedObjectKey(key)) return new Response("Invalid object key", { status: 400 });

    if (request.method === "GET") {
      const object = await this.env.AQUARIUM_R2.get(key);
      if (!object) return new Response(null, { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("ETag", object.httpEtag);
      headers.set("Cache-Control", "no-store");
      return new Response(object.body, { headers });
    }

    if (request.method === "PUT") {
      const contentType = request.headers.get("content-type");
      await this.env.AQUARIUM_R2.put(key, request.body, contentType ? { httpMetadata: { contentType } } : undefined);
      return new Response(null, { status: 204 });
    }

    if (request.method === "DELETE") {
      await this.env.AQUARIUM_R2.delete(key);
      return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, PUT, DELETE" } });
  }
}

function isPersistedPrefix(prefix: string): boolean {
  return prefix === "data/" || prefix === "public/images/";
}

function isPersistedObjectKey(key: string): boolean {
  return (key.startsWith("data/") || key.startsWith("public/images/"))
    && !key.split("/").some((part) => part === ".." || part === "." || part === "");
}
