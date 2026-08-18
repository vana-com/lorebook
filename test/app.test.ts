import { strict as assert } from "node:assert";
import test from "node:test";
import { mapConversationLore } from "../src/lib/chatgpt-conversations";
import { mapSpotifyProfile } from "../src/lib/spotify-profile";
import {
  mapSpotifySavedTracks,
  SAVED_TRACK_DISPLAY_FIELD_MAX_BYTES,
} from "../src/lib/spotify-saved-tracks";

test("maps a Spotify profile into the quick Lorebook chapter", () => {
  assert.deepEqual(mapSpotifyProfile({
    "spotify.profile": {
      id: "sam",
      display_name: "Sam",
      followers: 12,
      following: 4,
      images: ["https://i.scdn.co/image/sam"],
    },
  }), {
    displayName: "Sam",
    followers: 12,
    following: 4,
    imageUrl: "https://i.scdn.co/image/sam",
  });
});

test("summarizes ChatGPT conversation metadata without exposing message contents", () => {
  const lore = mapConversationLore({
    "chatgpt.conversations": {
      conversations: [
        { title: "Designing a garden studio", message_count: 8, messages: [{ content: "private" }] },
        { title: "Garden planting plan", messages: [{}, {}, {}] },
        { title: "API design review", message_count: 5 },
      ],
      total: 3,
    },
  });
  assert.equal(lore.totalConversations, 3);
  assert.equal(lore.totalMessages, 16);
  assert.equal(lore.themes[0], "Garden");
  assert.deepEqual(lore.recentTitles, [
    "Designing a garden studio",
    "Garden planting plan",
    "API design review",
  ]);
  assert.ok(!JSON.stringify(lore).includes("private"));
});

test("maps only a small proof from a real saved-tracks payload", () => {
  const mapped = mapSpotifySavedTracks({
    "spotify.savedTracks": {
      savedTracks: [
        { name: "Track one", artists: [{ name: "Artist one" }], uri: "private:one" },
        { name: "Track two", artists: [{ name: "Artist two" }] },
        { name: "Track three", artists: [] },
        { name: "Track four", artists: [{ name: "Artist four" }] },
      ],
      total: 27,
    },
  });

  assert.deepEqual(mapped, {
    total: 27,
    recentTracks: [
      { name: "Track one", artist: "Artist one" },
      { name: "Track two", artist: "Artist two" },
      { name: "Track three", artist: "Unknown artist" },
    ],
  });
  assert.equal(JSON.stringify(mapped).includes("private:one"), false);
});

test("normalizes and byte-bounds untrusted saved-track display fields", () => {
  const oversizedName = `  Cafe\u0301 ${"🎵".repeat(100)} trailing secret  `;
  const oversizedArtist = `  ${"藝術家".repeat(100)}  `;
  const mapped = mapSpotifySavedTracks({
    savedTracks: [
      { name: oversizedName, artists: [{ name: oversizedArtist }] },
      { name: "   ", artists: [{ name: "ignored" }] },
    ],
    total: 2,
  });

  assert.equal(mapped.recentTracks.length, 1);
  const [track] = mapped.recentTracks;
  assert.ok(track);
  assert.ok(track.name.startsWith("Café "));
  assert.equal(track.name.includes("trailing secret"), false);
  assert.ok(new TextEncoder().encode(track.name).byteLength <= SAVED_TRACK_DISPLAY_FIELD_MAX_BYTES);
  assert.ok(new TextEncoder().encode(track.artist).byteLength <= SAVED_TRACK_DISPLAY_FIELD_MAX_BYTES);
  assert.equal(track.name, track.name.normalize("NFC"));
  assert.equal(track.artist, track.artist.normalize("NFC"));
});
