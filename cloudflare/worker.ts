import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  AQUARIUM: DurableObjectNamespace<AquariumContainer>;
  AQUARIUM_R2: R2Bucket;
  /** Local-only bridge for `wrangler dev`; production uses the bound Container below. */
  AQUARIUM_ORIGIN?: string;
}

interface WorkerContext { waitUntil(promise: Promise<unknown>): void }

const FORWARD_USER_AGENT = "OpenAI File Downloader, XaiImageApiFetch/1.0";
const IMMUTABLE_IMAGE = /^\/images\/(?:artwork_[\w-]+\.png|fish_\d+\.png|scene\/[\w-]+\.[a-z0-9]+)$/i;
const LIBRARY_IMAGE = /^\/lib-images\/[\w.-]+\.png$/i;
const IMMUTABLE_TTL_SECONDS = 60 * 60 * 24 * 30;
const APP_ROUTES: Record<string, string> = { "/": "/index.html", "/display": "/display.html", "/controller": "/controller.html", "/guest": "/guest.html", "/manage": "/manage.html" };
const edgeCache = (caches as CacheStorage & { default: Cache }).default;

export default {
  async fetch(request: Request, env: Env, context: WorkerContext): Promise<Response> {
    const url = new URL(request.url);

    if (LIBRARY_IMAGE.test(url.pathname) || IMMUTABLE_IMAGE.test(url.pathname)) {
      return cacheImmutableImage(request, env, context);
    }

    if (url.pathname.startsWith("/api/") || url.pathname === "/ws" || url.pathname === "/health" || url.pathname.startsWith("/lib-images/")) {
      return routeToAquarium(request, env);
    }

    if (url.pathname.startsWith("/images/")) return routeToAquarium(request, env);

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
async function routeToAquarium(request: Request, env: Env): Promise<Response> {
  if (env.AQUARIUM_ORIGIN) return proxyApi(request, env.AQUARIUM_ORIGIN);
  if (!env.AQUARIUM) return Response.json({ error: "Aquarium Container binding is missing" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const response = await env.AQUARIUM.getByName("main").fetch(request);
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function proxyApi(request: Request, origin: string): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const destination = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, origin);
  const headers = new Headers(request.headers);
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
  if (request.method !== "GET") return routeToAquarium(request, env);
  const url = new URL(request.url);
  if (env.AQUARIUM_ORIGIN) return routeToAquarium(request, env);

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

  async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container;
    if (!container) return new Response("Container binding is unavailable", { status: 503 });

    if (Date.now() > this.readyUntil) {
      this.starting ??= this.startAndWaitForPort().finally(() => {
        this.starting = undefined;
      });
      try {
        await this.starting;
        this.readyUntil = Date.now() + 5_000;
      } catch (error) {
        console.error("[AquariumContainer] Container startup failed:", error);
        return new Response("Aquarium runtime is starting; retry shortly", { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store" } });
      }
    }

    const upstreamUrl = new URL(request.url);
    upstreamUrl.protocol = "http:";
    upstreamUrl.host = "container";
    const forwarded = new Request(upstreamUrl, request);
    forwarded.headers.delete("host");
    forwarded.headers.set("User-Agent", FORWARD_USER_AGENT);
    try {
      return await container.getTcpPort(3000).fetch(forwarded);
    } catch (error) {
      this.readyUntil = 0;
      throw error;
    }
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    const r2Bridge = this.ctx.exports.AquariumR2Bridge({ props: {} });
    await container.interceptOutboundHttp("aquarium-r2.internal", r2Bridge);
    if (!container.running) {
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
        () => console.error("[AquariumContainer] Container exited."),
        (error) => console.error("[AquariumContainer] Container exited with an error:", error),
      ));
    }
    await container.setInactivityTimeout(10 * 60 * 1000);
    const port = container.getTcpPort(3000);
    for (let attempt = 0; attempt < 240; attempt++) {
      try {
        const response = await port.fetch(new Request("http://container/health", {
          headers: { "User-Agent": FORWARD_USER_AGENT },
          signal: AbortSignal.timeout(1_000),
        }));
        await response.body?.cancel();
        if (response.ok) return;
        throw new Error(`Health check returned ${response.status}`);
      } catch {
        // The container process has started but Bun has not bound its HTTP port yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Container did not become ready on port 3000");
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
