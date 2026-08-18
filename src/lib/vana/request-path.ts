import {
  DESKTOP_SAVED_TRACKS_FIXTURE,
  type LorebookJourney,
} from "./constants";
import type { VanaRuntime } from "./runtime";

/** Forward only the two public runtime selectors from the app URL. */
export function buildRequestPath(mode: LorebookJourney, search: string): string {
  const input = new URLSearchParams(search);
  const request = new URLSearchParams({
    mode: mode === "desktop-saved-tracks" ? "deep" : mode,
  });
  for (const key of ["vana_env", "network"]) {
    for (const value of input.getAll(key)) request.append(key, value);
  }
  if (mode === "desktop-saved-tracks") {
    request.set("fixture", DESKTOP_SAVED_TRACKS_FIXTURE);
  }
  return `/api/vana/request?${request.toString()}`;
}

/** Canonical Lorebook URL for a runtime recovered from a signed request. */
export function buildHomePath(runtime: VanaRuntime, journey?: LorebookJourney): string {
  const params = new URLSearchParams();
  if (runtime.env === "dev") params.set("vana_env", "dev");
  if (runtime.network === "moksha") params.set("network", "moksha");
  if (journey === "desktop-saved-tracks") {
    params.set("fixture", DESKTOP_SAVED_TRACKS_FIXTURE);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}
