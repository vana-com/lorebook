export function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function jsonNoStore(data: unknown, init?: ResponseInit): Response {
  return noStore(Response.json(data, init));
}
