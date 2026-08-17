"use client";

import {
  useDirectVanaConnect,
  type AccessRequest,
  type AccessRequestStatus,
  type ApprovedDataResult,
} from "@opendatalabs/vana-sdk/react";
import Link from "next/link";
import { useState } from "react";
import type { LorebookSnapshot } from "@/lib/combined-snapshot";
import type { LorebookMode } from "@/lib/vana/constants";

type ErrorBody = { error?: unknown };

const CHAPTERS: Record<
  LorebookMode,
  { eyebrow: string; title: string; description: string; source: string; promise: string }
> = {
  quick: {
    eyebrow: "A quick read",
    title: "Your public rhythm",
    description: "Start with your Spotify profile. A light touch, no account history required.",
    source: "Spotify profile",
    promise: "Usually under a minute",
  },
  deep: {
    eyebrow: "The deep cut",
    title: "Your curiosity map",
    description: "Find the ideas you return to across your ChatGPT conversations.",
    source: "ChatGPT conversations",
    promise: "Opens the Vana app when needed",
  },
};

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const candidate = isRecord(body) ? (body as ErrorBody).error : undefined;
    throw new Error(typeof candidate === "string" ? candidate : "Lorebook could not finish that read.");
  }
  return (await response.json()) as T;
}

function requestPath(mode: LorebookMode): string {
  const input = new URLSearchParams(window.location.search);
  const launch = new URLSearchParams({ mode });
  for (const key of ["vana_env", "network"]) {
    for (const value of input.getAll(key)) launch.append(key, value);
  }
  return `/api/vana/request?${launch.toString()}`;
}

export function LorebookApp() {
  const [mode, setMode] = useState<LorebookMode>("quick");
  const connect = useDirectVanaConnect<LorebookSnapshot>({
    createRequest: () => jsonFetch<AccessRequest>(requestPath(mode), { method: "POST" }),
    getStatus: (requestId) =>
      jsonFetch<AccessRequestStatus>(`/api/vana/status?requestId=${encodeURIComponent(requestId)}`),
    readResult: (requestId) =>
      jsonFetch<ApprovedDataResult<LorebookSnapshot>>(
        `/api/vana/read?requestId=${encodeURIComponent(requestId)}`,
      ),
  });
  const data = connect.state.type === "done" ? connect.state.result.data : null;
  const busy = ["creating", "awaiting_approval", "reading"].includes(connect.state.type);

  function chooseMode(next: LorebookMode) {
    if (next === mode || busy) return;
    connect.reset();
    setMode(next);
  }

  return (
    <main className="lorebook-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Lorebook home">
          <LogoMark />
          <span>Lorebook</span>
        </Link>
        <span className="privacy-note"><LockIcon /> You choose every page</span>
      </header>

      <section className="hero">
        <p className="kicker">Your data, told back to you</p>
        <h1>Meet the version of you hiding in plain sight.</h1>
        <p className="hero-copy">
          Lorebook turns patterns from the data you approve into a small, surprising portrait.
          Nothing is posted. Nothing is read without asking.
        </p>
      </section>

      <section className="workspace" aria-label="Create your Lorebook">
        <div className="chapter-picker">
          <SectionHeading number="01" label="Choose a chapter" title="How deep should we read?" />
          <div className="chapter-options">
            {(Object.keys(CHAPTERS) as LorebookMode[]).map((chapterMode) => {
              const chapter = CHAPTERS[chapterMode];
              const selected = chapterMode === mode;
              return (
                <button
                  className={`chapter-option${selected ? " selected" : ""}`}
                  type="button"
                  key={chapterMode}
                  onClick={() => chooseMode(chapterMode)}
                  disabled={busy}
                  aria-pressed={selected}
                >
                  <span className="chapter-radio" aria-hidden="true"><span /></span>
                  <span className="chapter-content">
                    <span className="chapter-eyebrow">{chapter.eyebrow}</span>
                    <strong>{chapter.title}</strong>
                    <span>{chapter.description}</span>
                    <small>{chapter.source} · {chapter.promise}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="portrait-stage">
          <SectionHeading number="02" label="Your portrait" title={data ? "A first page, written" : "Waiting for your signal"} light />
          <div className="portrait-card">
            {data ? <LoreResult data={data} /> : <EmptyPortrait mode={mode} />}
          </div>
          <ConnectAction connect={connect} mode={mode} />
        </div>
      </section>

      <footer>
        <p>Lorebook reads only the data types shown above, through Vana.</p>
        <p>Built to be curious, never nosy.</p>
      </footer>
    </main>
  );
}

function SectionHeading({ number, label, title, light = false }: { number: string; label: string; title: string; light?: boolean }) {
  return <div className={`section-heading${light ? " light" : ""}`}><span>{number}</span><div><p>{label}</p><h2>{title}</h2></div></div>;
}

function EmptyPortrait({ mode }: { mode: LorebookMode }) {
  return (
    <div className="empty-portrait">
      <div className={`portrait-orbit ${mode}`} aria-hidden="true">
        <span className="orbit-dot one" /><span className="orbit-dot two" /><span className="orbit-dot three" />
        <LogoMark />
      </div>
      <p>{mode === "quick" ? "A small signal is enough to begin." : "Your recurring questions leave a constellation."}</p>
    </div>
  );
}

function LoreResult({ data }: { data: LorebookSnapshot }) {
  if (data.kind === "quick") {
    const { spotify } = data;
    return (
      <article className="lore-result">
        <p className="result-label">Public rhythm</p>
        <div className="identity-row">
          <div className="result-monogram">{spotify.displayName.charAt(0).toUpperCase() || "♪"}</div>
          <div><h3>{spotify.displayName}</h3><p>Your public music self has entered the story.</p></div>
        </div>
        <div className="metric-row">
          <Metric value={spotify.followers} label="followers" />
          <Metric value={spotify.following} label="following" />
        </div>
        <p className="result-voice">A social listener: collecting people and being collected in return.</p>
      </article>
    );
  }

  const lore = data.conversations;
  return (
    <article className="lore-result">
      <p className="result-label">Curiosity map</p>
      <h3>You keep pulling on interesting threads.</h3>
      <div className="metric-row">
        <Metric value={lore.totalConversations} label="conversations" />
        <Metric value={lore.totalMessages} label="messages" />
      </div>
      <div className="theme-cloud">
        {(lore.themes.length > 0 ? lore.themes : ["Curious", "Exploring", "Making"]).map((theme) => <span key={theme}>{theme}</span>)}
      </div>
      <p className="result-voice">Your chats read like a workshop with the lights always on.</p>
    </article>
  );
}

function Metric({ value, label }: { value: number | null; label: string }) {
  return <div className="metric"><strong>{value == null ? "—" : value.toLocaleString()}</strong><span>{label}</span></div>;
}

function ConnectAction({ connect, mode }: { connect: ReturnType<typeof useDirectVanaConnect<LorebookSnapshot>>; mode: LorebookMode }) {
  const state = connect.state;
  const popupBlocked = state.type === "awaiting_approval" && state.popupBlocked;
  if (state.type === "done") {
    return <button className="secondary-button" type="button" onClick={() => connect.reset()}>Write another page</button>;
  }

  return (
    <div className="connect-action" aria-live="polite">
      <p>{statusCopy(state.type, popupBlocked, mode)}</p>
      {popupBlocked && state.type === "awaiting_approval" ? <a className="secondary-button" href={state.request.approvalUrl} target="_blank" rel="noreferrer">Open Vana approval</a> : null}
      {state.type === "idle" ? <button className="primary-button" type="button" onClick={() => void connect.start()}>{mode === "quick" ? "Read my public rhythm" : "Map my curiosities"}<ArrowIcon /></button> : null}
      {["creating", "awaiting_approval", "reading"].includes(state.type) ? <button className="primary-button loading" type="button" disabled><span className="spinner" />{state.type === "reading" ? "Writing your page…" : "Waiting for Vana…"}</button> : null}
      {state.type === "error" ? <button className="primary-button" type="button" onClick={() => { connect.reset(); void connect.start(); }}>Try that again<ArrowIcon /></button> : null}
      <details className="connection-details">
        <summary>Connection details</summary>
        <dl><div><dt>Journey</dt><dd>{mode}</dd></div><div><dt>State</dt><dd>{state.type}</dd></div><div><dt>Network</dt><dd>{networkLabel()}</dd></div></dl>
      </details>
    </div>
  );
}

function statusCopy(type: string, popupBlocked: boolean, mode: LorebookMode): string {
  if (popupBlocked) return "Your browser held the approval tab back. Open it to keep going.";
  if (type === "idle") return mode === "quick" ? "We’ll ask for your Spotify profile—nothing more." : "We’ll ask for your ChatGPT conversations and summarize patterns locally.";
  if (type === "creating") return "Opening a private data request…";
  if (type === "awaiting_approval") return "Approve the request in Vana, then come back here.";
  if (type === "reading") return "Reading only what you approved…";
  if (type === "error") return "That page stayed blank. No new data was added to Lorebook.";
  return "";
}

function networkLabel(): string {
  if (typeof window === "undefined") return "moksha";
  return new URLSearchParams(window.location.search).get("network") ?? "moksha";
}

function LogoMark() {
  return <svg className="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 7.5c7.5 0 12 3.8 12 10.2C20 11.3 24.5 7.5 32 7.5v24c-7.5 0-12 2.3-12 6-0.1-3.7-4.5-6-12-6v-24Z" fill="currentColor"/><path d="M20 17.7v19.8" stroke="var(--paper)" strokeWidth="1.6"/></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="8" width="11" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M7 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
