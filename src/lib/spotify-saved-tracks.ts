export type SpotifySavedTracks = {
  total: number;
  recentTracks: { name: string; artist: string }[];
};

export function mapSpotifySavedTracks(data: unknown): SpotifySavedTracks {
  const payload = unwrap(data);
  const tracks = Array.isArray(payload?.savedTracks) ? payload.savedTracks : [];
  const recentTracks = tracks.flatMap((value) => {
    if (!isRecord(value) || typeof value.name !== "string") return [];
    const artists = Array.isArray(value.artists) ? value.artists : [];
    const artist = artists.find(
      (candidate): candidate is Record<string, unknown> =>
        isRecord(candidate) && typeof candidate.name === "string",
    )?.name;
    return [{ name: value.name, artist: typeof artist === "string" ? artist : "Unknown artist" }];
  }).slice(0, 3);
  const declaredTotal = typeof payload?.total === "number" ? payload.total : null;
  return {
    total: declaredTotal !== null && Number.isFinite(declaredTotal)
      ? Math.max(0, Math.trunc(declaredTotal))
      : tracks.length,
    recentTracks,
  };
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
