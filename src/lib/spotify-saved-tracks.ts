export type SpotifySavedTracks = {
  total: number;
  recentTracks: { name: string; artist: string }[];
};

export const SAVED_TRACK_DISPLAY_FIELD_MAX_BYTES = 160;

export function mapSpotifySavedTracks(data: unknown): SpotifySavedTracks {
  const payload = unwrap(data);
  const tracks = Array.isArray(payload?.savedTracks) ? payload.savedTracks : [];
  const recentTracks = tracks.flatMap((value) => {
    if (!isRecord(value) || typeof value.name !== "string") return [];
    const name = normalizeDisplayField(value.name);
    if (!name) return [];
    const artists = Array.isArray(value.artists) ? value.artists : [];
    const rawArtist = artists.find(
      (candidate): candidate is Record<string, unknown> =>
        isRecord(candidate) && typeof candidate.name === "string",
    )?.name;
    const artist = typeof rawArtist === "string" ? normalizeDisplayField(rawArtist) : null;
    return [{ name, artist: artist || "Unknown artist" }];
  }).slice(0, 3);
  const declaredTotal = typeof payload?.total === "number" ? payload.total : null;
  return {
    total: declaredTotal !== null && Number.isFinite(declaredTotal)
      ? Math.max(0, Math.trunc(declaredTotal))
      : tracks.length,
    recentTracks,
  };
}

/** Normalize untrusted display strings and cap their encoded payload size. */
function normalizeDisplayField(value: string): string | null {
  const normalized = value.normalize("NFC").trim();
  if (!normalized) return null;

  const encoder = new TextEncoder();
  let result = "";
  let bytes = 0;
  for (const character of normalized) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > SAVED_TRACK_DISPLAY_FIELD_MAX_BYTES) break;
    result += character;
    bytes += characterBytes;
  }
  return result || null;
}

function unwrap(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  for (const key of ["spotify.savedTracks", "data", "result"]) {
    if (isRecord(data[key])) return data[key];
  }
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
