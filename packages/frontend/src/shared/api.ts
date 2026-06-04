type JsonBody = Record<string, unknown> | unknown[];

function withJsonBody(body: JsonBody): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(path, init);
  },

  get(path: string): Promise<Response> {
    return fetch(path);
  },

  post(path: string, body?: JsonBody | FormData): Promise<Response> {
    return fetch(path, {
      method: "POST",
      ...(body instanceof FormData ? { body } : body === undefined ? {} : withJsonBody(body)),
    });
  },

  put(path: string, body: JsonBody): Promise<Response> {
    return fetch(path, { method: "PUT", ...withJsonBody(body) });
  },

  delete(path: string): Promise<Response> {
    return fetch(path, { method: "DELETE" });
  },

  async getJson<T>(path: string): Promise<T> {
    const response = await fetch(path);
    return response.json() as Promise<T>;
  },
};
