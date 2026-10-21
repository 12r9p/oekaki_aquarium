type JsonBody = Record<string, unknown> | unknown[];

const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
const COMMAND_ID_HEADER = "X-Aquarium-Command-Id";

function createCommandId(): string {
  const prefix = `cmd_${Date.now().toString(36)}_`;
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}${Math.random().toString(36).slice(2).padEnd(12, "0")}`;
}

function withCommandIds(init: RequestInit): RequestInit {
  const method = init.method?.toUpperCase() ?? "GET";
  if (method === "GET" || method === "HEAD") return init;

  const headers = new Headers(init.headers);
  const commandId =
    headers.get(IDEMPOTENCY_KEY_HEADER) ??
    headers.get(COMMAND_ID_HEADER) ??
    createCommandId();

  if (!headers.has(IDEMPOTENCY_KEY_HEADER)) {
    headers.set(IDEMPOTENCY_KEY_HEADER, commandId);
  }
  if (!headers.has(COMMAND_ID_HEADER)) {
    headers.set(COMMAND_ID_HEADER, commandId);
  }

  return { ...init, headers };
}

function assertSameOrigin(path: string): void {
  const baseUrl =
    typeof globalThis.location === "undefined"
      ? "http://localhost/"
      : globalThis.location.href;
  const requestUrl = new URL(path, baseUrl);
  if (requestUrl.origin !== new URL(baseUrl).origin) {
    throw new TypeError("API requests must stay on the current origin");
  }
}

function mergeHeaders(...sources: (HeadersInit | undefined)[]): Headers {
  const headers = new Headers();
  for (const source of sources) {
    new Headers(source).forEach((value, name) => headers.set(name, value));
  }
  return headers;
}

function mergeInit(defaults: RequestInit, overrides?: RequestInit): RequestInit {
  return {
    ...defaults,
    ...overrides,
    headers: mergeHeaders(defaults.headers, overrides?.headers),
  };
}

function withJsonBody(body: JsonBody): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  request(path: string, init?: RequestInit): Promise<Response> {
    assertSameOrigin(path);
    return fetch(path, withCommandIds(init ?? {}));
  },

  get(path: string): Promise<Response> {
    return api.request(path);
  },

  post(path: string, body?: JsonBody | FormData, init?: RequestInit): Promise<Response> {
    return api.request(path, mergeInit({
      method: "POST",
      ...(body instanceof FormData ? { body } : body === undefined ? {} : withJsonBody(body)),
    }, init));
  },

  put(path: string, body: JsonBody, init?: RequestInit): Promise<Response> {
    return api.request(path, mergeInit({ method: "PUT", ...withJsonBody(body) }, init));
  },

  delete(path: string, init?: RequestInit): Promise<Response> {
    return api.request(path, mergeInit({ method: "DELETE" }, init));
  },

  async getJson<T>(path: string): Promise<T> {
    const response = await api.request(path);
    return response.json() as Promise<T>;
  },
};
