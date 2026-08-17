export type VanaAppDefinition = {
  id: string;
  name: string;
  /**
   * Primary `source_id` sent on the data-connection request. A DCR carries a
   * single source_id; the requested `scopes` may span sources, and the single
   * grant the approval mints (one grant per user + app) covers all of them.
   */
  source: string;
  /**
   * Every scope requested together in ONE data-connection request. Requesting
   * all scopes at once makes the approval mint ONE grant that covers them all,
   * so a later approval never overwrites an earlier grant's scopes. Splitting
   * these into separate DCRs is what triggers the scope-overwrite collision
   * (BUI-732): the grant is keyed by (user, app) only, and each approval
   * REPLACES its scopes.
   */
  scopes: readonly string[];
};

export const SPOTIFY_PROFILE_SCOPE = "spotify.profile";
export const CHATGPT_CONVERSATIONS_SCOPE = "chatgpt.conversations";

/** Light/browser-completable Lorebook chapter. */
export const LOREBOOK_QUICK_APP: VanaAppDefinition = {
  id: "lorebook-quick-read",
  name: "Lorebook",
  source: sourceFromScope(SPOTIFY_PROFILE_SCOPE),
  scopes: [SPOTIFY_PROFILE_SCOPE],
};

export const LOREBOOK_DEEP_APP: VanaAppDefinition = {
  id: "lorebook-deep-read",
  name: "Lorebook",
  source: sourceFromScope(CHATGPT_CONVERSATIONS_SCOPE),
  scopes: [CHATGPT_CONVERSATIONS_SCOPE],
};

export const LOREBOOK_APPS = [LOREBOOK_QUICK_APP, LOREBOOK_DEEP_APP] as const;

export type LorebookMode = "quick" | "deep";

export function appForMode(mode: LorebookMode): VanaAppDefinition {
  return mode === "deep" ? LOREBOOK_DEEP_APP : LOREBOOK_QUICK_APP;
}

export function appForId(id: string): VanaAppDefinition | null {
  return LOREBOOK_APPS.find((app) => app.id === id) ?? null;
}

export const REQUEST_BINDING_TTL_MS = 60 * 60 * 1000;

/** Derive the source id from a scope (`"spotify.profile"` → `"spotify"`). */
export function sourceFromScope(scope: string): string {
  const dot = scope.indexOf(".");
  return dot === -1 ? scope : scope.slice(0, dot);
}
