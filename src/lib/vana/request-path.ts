import type { LorebookMode } from "./constants";
import type { VanaRuntime } from "./runtime";

/** Forward only the two public runtime selectors from the app URL. */
export function buildRequestPath(mode: LorebookMode, search: string): string {
  const input = new URLSearchParams(search);
  const request = new URLSearchParams({ mode });
  for (const key of ["vana_env", "network"]) {
    for (const value of input.getAll(key)) request.append(key, value);
  }
  return `/api/vana/request?${request.toString()}`;
}

/** Canonical Lorebook URL for a runtime recovered from a signed request. */
export function buildHomePath(runtime: VanaRuntime): string {
  const params = new URLSearchParams();
  if (runtime.env === "dev") params.set("vana_env", "dev");
  if (runtime.network === "moksha") params.set("network", "moksha");
  const query = params.toString();
  return query ? `/?${query}` : "/";
}
