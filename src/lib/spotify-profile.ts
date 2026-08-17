export interface SpotifyProfile {
  displayName: string;
  followers: number | null;
  following: number | null;
  imageUrl: string | null;
}

type RecordValue = Record<string, unknown>;

export function mapSpotifyProfile(input: unknown): SpotifyProfile {
  const profile = unwrap(input);
  return {
    displayName: stringValue(profile, ["display_name", "displayName", "name"]) || "Music person",
    followers: numberValue(profile, ["followers", "followerCount", "follower_count"]),
    following: numberValue(profile, ["following", "followingCount", "following_count"]),
    imageUrl: imageValue(profile?.images ?? profile?.image ?? profile?.imageUrl),
  };
}

function unwrap(input: unknown, depth = 0): RecordValue | null {
  if (depth > 4) return null;
  if (Array.isArray(input)) return unwrap(input[0], depth + 1);
  if (!isRecord(input)) return null;
  if (["display_name", "displayName", "followers", "following"].some((key) => key in input)) {
    return input;
  }
  for (const key of ["spotify.profile", "profile", "data", "result", "user"]) {
    if (key in input) {
      const nested = unwrap(input[key], depth + 1);
      if (nested) return nested;
    }
  }
  return input;
}

function stringValue(input: RecordValue | null, keys: string[]): string {
  if (!input) return "";
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberValue(input: RecordValue | null, keys: string[]): number | null {
  if (!input) return null;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (isRecord(value) && typeof value.total === "number" && Number.isFinite(value.total)) {
      return value.total;
    }
  }
  return null;
}

function imageValue(input: unknown): string | null {
  if (typeof input === "string" && /^https:\/\//.test(input)) return input;
  if (Array.isArray(input)) {
    for (const value of input) {
      const image = imageValue(value);
      if (image) return image;
    }
  }
  if (isRecord(input)) return imageValue(input.url ?? input.src);
  return null;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
