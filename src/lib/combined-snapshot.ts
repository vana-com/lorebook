import { mapConversationLore, type ConversationLore } from "@/lib/chatgpt-conversations";
import { mapSpotifyProfile, type SpotifyProfile } from "@/lib/spotify-profile";
import { mapSpotifySavedTracks, type SpotifySavedTracks } from "@/lib/spotify-saved-tracks";
import {
  CHATGPT_CONVERSATIONS_SCOPE,
  SPOTIFY_PROFILE_SCOPE,
  SPOTIFY_SAVED_TRACKS_SCOPE,
  type VanaAppDefinition,
} from "@/lib/vana/constants";

/** Product-safe result from one approved Lorebook chapter. */
export type LorebookSnapshot =
  | { kind: "quick"; spotify: SpotifyProfile }
  | { kind: "deep"; conversations: ConversationLore }
  | { kind: "desktop-fixture"; savedTracks: SpotifySavedTracks };

export function mapLorebookSnapshot(
  app: VanaAppDefinition,
  scope: string,
  data: unknown,
): LorebookSnapshot {
  if (scope === CHATGPT_CONVERSATIONS_SCOPE) {
    return { kind: "deep", conversations: mapConversationLore(data) };
  }
  if (scope === SPOTIFY_PROFILE_SCOPE) {
    return { kind: "quick", spotify: mapSpotifyProfile(data) };
  }
  if (scope === SPOTIFY_SAVED_TRACKS_SCOPE) {
    return { kind: "desktop-fixture", savedTracks: mapSpotifySavedTracks(data) };
  }
  throw new Error(`Lorebook cannot read ${scope} for ${app.id}.`);
}
