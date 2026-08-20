"use client";

import {
  useDirectVanaConnect,
  type AccessRequest,
  type AccessRequestStatus,
  type ApprovedDataResult,
} from "@opendatalabs/vana-sdk/react";
import { useEffect, useState } from "react";
import type { LorebookSnapshot } from "@/lib/combined-snapshot";
import { type LorebookJourney, type LorebookMode } from "@/lib/vana/constants";
import { buildRequestPath, buildRuntimeSwitchPath } from "@/lib/vana/request-path";
import {
  resolveFixtureJourney,
  resolveLaunchRuntime,
  runtimeOptionId,
  RUNTIME_OPTIONS,
  type VanaRuntime,
} from "@/lib/vana/runtime";

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

// States that render the disabled progress button. `ready_to_open` is excluded:
// there the explicit "Open Vana" link is the primary affordance, not a spinner.
// (Once the user has been to Vana and come back, `ready_to_open` does get a
// spinner — see `Handoff` below.)
const SPINNER_STATES = ["creating", "awaiting_approval", "reading"];

// Vana finishing on the phone is invisible to this tab: the SDK stays in
// `ready_to_open` until the next status poll lands, so for a couple of seconds
// after Safari comes back the primary button still says "Open Vana" and it
// reads as if the handoff did nothing. Nothing in the flow tells us the user
// returned, so we infer it locally: they tapped the link ("opened"), then this
// tab became visible again ("returned").
type Handoff = "none" | "opened" | "returned";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const candidate = isRecord(body) ? (body as ErrorBody).error : undefined;
    throw new Error(typeof candidate === "string" ? candidate : "Lorebook could not finish that read.");
  }
  return (await response.json()) as T;
}

export function LorebookApp() {
  const [mode, setMode] = useState<LorebookJourney>("quick");
  const connect = useDirectVanaConnect<LorebookSnapshot>({
    createRequest: () => jsonFetch<AccessRequest>(buildRequestPath(mode, window.location.search), { method: "POST" }),
    getStatus: (requestId) =>
      jsonFetch<AccessRequestStatus>(`/api/vana/status?requestId=${encodeURIComponent(requestId)}`),
    readResult: (requestId) =>
      jsonFetch<ApprovedDataResult<LorebookSnapshot>>(
        `/api/vana/read?requestId=${encodeURIComponent(requestId)}`,
      ),
  });
  const data = connect.state.type === "done" ? connect.state.result.data : null;

  // The originating tab owns the whole flow: create → status poll → read → ack.
  // Nothing is persisted, so if this tab is reloaded or evicted the flow does
  // not resume; the user restarts and the abandoned DCR expires. The only
  // launch-time concern here is surfacing the hidden Desktop QA fixture.
  useEffect(() => {
    if (isDesktopFixtureSearch(window.location.search)) setMode("desktop-saved-tracks");
  }, []);

  function chooseMode(next: LorebookMode) {
    if (next === mode) return;
    connect.reset();
    setMode(next);
  }

  return (
    <main className="lorebook-shell">
      <NetworkSwitch />

      <header className="site-header">
        <span className="brand">
          <LogoMark />
          <span>Lorebook</span>
        </span>
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
            {mode === "desktop-saved-tracks" ? (
              <div className="chapter-option selected" data-testid="desktop-saved-tracks-fixture">
                <span className="chapter-radio" aria-hidden="true"><span /></span>
                <span className="chapter-content">
                  <span className="chapter-eyebrow">Desktop E2E fixture</span>
                  <strong>Your liked-song library</strong>
                  <span>Import a missing private Spotify scope through Vana Desktop.</span>
                  <small>Spotify saved tracks · Dev and Moksha only</small>
                </span>
              </div>
            ) : null}
            {mode !== "desktop-saved-tracks" ? (Object.keys(CHAPTERS) as LorebookMode[]).map((chapterMode) => {
              const chapter = CHAPTERS[chapterMode];
              const selected = chapterMode === mode;
              return (
                <button
                  className={`chapter-option${selected ? " selected" : ""}`}
                  type="button"
                  key={chapterMode}
                  onClick={() => chooseMode(chapterMode)}
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
            }) : null}
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

/**
 * Dev affordance. Lorebook defaults to production + mainnet when the URL says
 * nothing, so testers on the bare URL silently drive production. Changing the
 * runtime is a full navigation on purpose: the SDK controller is keyed by
 * env/network, so every in-memory flow state must be dropped with it.
 */
function NetworkSwitch() {
  const [runtime, setRuntime] = useState<VanaRuntime | "invalid" | null>(null);
  const [journey, setJourney] = useState<LorebookJourney | undefined>(undefined);

  useEffect(() => {
    const search = window.location.search;
    try {
      setRuntime(resolveLaunchRuntime(new URLSearchParams(search)));
    } catch {
      setRuntime("invalid");
    }
    if (isDesktopFixtureSearch(search)) setJourney("desktop-saved-tracks");
  }, []);

  const selected = runtime && runtime !== "invalid" ? runtimeOptionId(runtime) : null;
  const tone = runtime === null ? "pending" : selected ?? "custom";
  const offMenu =
    runtime === "invalid"
      ? "Invalid URL"
      : runtime && selected === null
        ? `${runtime.env} · ${runtime.network}`
        : null;

  return (
    <div className={`network-switch ${tone}`} data-testid="network-switch">
      <span className="network-dot" aria-hidden="true" />
      <label htmlFor="network-switch-select">Network</label>
      <select
        id="network-switch-select"
        value={selected ?? ""}
        disabled={runtime === null}
        onChange={(event) => {
          const next = RUNTIME_OPTIONS.find((option) => option.id === event.target.value);
          if (next) window.location.assign(buildRuntimeSwitchPath(next.runtime, journey));
        }}
      >
        {runtime === null ? <option value="">Checking…</option> : null}
        {offMenu ? <option value="">{offMenu}</option> : null}
        {RUNTIME_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function SectionHeading({ number, label, title, light = false }: { number: string; label: string; title: string; light?: boolean }) {
  return <div className={`section-heading${light ? " light" : ""}`}><span>{number}</span><div><p>{label}</p><h2>{title}</h2></div></div>;
}

function EmptyPortrait({ mode }: { mode: LorebookJourney }) {
  return (
    <div className="empty-portrait">
      <div className={`portrait-orbit ${mode}`} aria-hidden="true">
        <span className="orbit-dot one" /><span className="orbit-dot two" /><span className="orbit-dot three" />
        <LogoMark />
      </div>
      <p>{mode === "quick" ? "A small signal is enough to begin." : mode === "desktop-saved-tracks" ? "Your liked songs are waiting in Desktop." : "Your recurring questions leave a constellation."}</p>
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

  if (data.kind === "desktop-fixture") {
    return (
      <article className="lore-result">
        <p className="result-label">Desktop import verified</p>
        <h3>Your liked-song library made the round trip.</h3>
        <div className="metric-row">
          <Metric value={data.savedTracks.total} label="liked songs" />
          <Metric value={data.savedTracks.recentTracks.length} label="tracks sampled" />
        </div>
        <div className="theme-cloud">
          {data.savedTracks.recentTracks.map((track) => (
            <span key={`${track.name}:${track.artist}`}>{track.name} · {track.artist}</span>
          ))}
        </div>
        <p className="result-voice">Paid Personal Server read completed.</p>
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

function ConnectAction({ connect, mode }: { connect: ReturnType<typeof useDirectVanaConnect<LorebookSnapshot>>; mode: LorebookJourney }) {
  const state = connect.state;
  // Mobile-deep: after asynchronous DCR creation the SDK exposes the single
  // continuation URL. The original click's iOS user activation cannot be
  // trusted across the await, so it is never launched automatically — the user
  // taps one explicit primary link that opens Vana in a separate context while
  // this tab keeps polling.
  const mobileContinuationUrl =
    state.type === "ready_to_open" ? state.mobileContinuationUrl : null;
  // Desktop/light: preserve the synchronous popup contract. When the popup is
  // blocked, surface the universal HTTPS approval URL as manual recovery.
  const approvalRecoveryUrl =
    state.type === "awaiting_approval" && state.popupBlocked ? state.request.approvalUrl : null;
  const [handoff, setHandoff] = useState<Handoff>("none");
  const returningFromVana = handoff === "returned" && mobileContinuationUrl !== null;

  // Any move off `ready_to_open` (poll landed, reset, restart) ends the handoff.
  useEffect(() => {
    if (state.type !== "ready_to_open") setHandoff("none");
  }, [state.type]);

  useEffect(() => {
    if (handoff !== "opened") return;
    // `visibilitychange` covers the normal app-to-Safari return; `pageshow`
    // covers a bfcache restore, where visibility may never flip.
    const noteReturn = () => {
      if (document.visibilityState === "visible") setHandoff("returned");
    };
    document.addEventListener("visibilitychange", noteReturn);
    window.addEventListener("pageshow", noteReturn);
    return () => {
      document.removeEventListener("visibilitychange", noteReturn);
      window.removeEventListener("pageshow", noteReturn);
    };
  }, [handoff]);

  if (state.type === "done") {
    return <button className="secondary-button reset-button" type="button" onClick={() => connect.reset()}>Write another page</button>;
  }

  return (
    <div className="connect-action" aria-live="polite">
      <p>{statusCopy(state.type, Boolean(mobileContinuationUrl), Boolean(approvalRecoveryUrl), mode, returningFromVana)}</p>
      {mobileContinuationUrl ? (
        returningFromVana ? (
          <>
            <button className="primary-button loading" type="button" disabled><span className="spinner" />Getting your data…</button>
            <a className="secondary-button" href={mobileContinuationUrl} target="_blank" rel="noreferrer" onClick={() => setHandoff("opened")}>Didn’t finish? Open Vana again</a>
          </>
        ) : (
          <a className="primary-button" href={mobileContinuationUrl} target="_blank" rel="noreferrer" onClick={() => setHandoff("opened")}>Open Vana<ArrowIcon /></a>
        )
      ) : null}
      {approvalRecoveryUrl ? (
        <a className="secondary-button" href={approvalRecoveryUrl} target="_blank" rel="noreferrer">Open Vana approval</a>
      ) : null}
      {state.type === "idle" ? <button className="primary-button" type="button" onClick={() => void connect.start()}>{mode === "quick" ? "Read my public rhythm" : mode === "desktop-saved-tracks" ? "Import my liked songs" : "Map my curiosities"}<ArrowIcon /></button> : null}
      {SPINNER_STATES.includes(state.type) ? <button className="primary-button loading" type="button" disabled><span className="spinner" />{state.type === "reading" ? "Writing your page…" : "Waiting for Vana…"}</button> : null}
      {state.type === "error" ? <button className="primary-button" type="button" onClick={() => { connect.reset(); void connect.start(); }}>Try that again<ArrowIcon /></button> : null}
      <details className="connection-details">
        <summary>Connection details</summary>
        <dl><div><dt>Journey</dt><dd>{mode}</dd></div><div><dt>State</dt><dd>{state.type}</dd></div><RuntimeDetails /></dl>
      </details>
    </div>
  );
}

function statusCopy(type: string, hasMobileContinuation: boolean, hasApprovalRecovery: boolean, mode: LorebookJourney, returningFromVana = false): string {
  if (returningFromVana) return "Welcome back—we’re picking up what you approved in Vana. This takes a few seconds.";
  if (hasMobileContinuation) return "Open Vana to review this request, then come back to this tab.";
  if (hasApprovalRecovery) return "Vana approval is ready. Open it to continue.";
  if (type === "idle") return mode === "quick" ? "We’ll ask for your Spotify profile—nothing more." : mode === "desktop-saved-tracks" ? "We’ll ask Vana Desktop for your Spotify saved tracks." : "We’ll ask for your ChatGPT conversations and summarize patterns locally.";
  if (type === "creating") return "Opening a private data request…";
  if (type === "awaiting_approval") return "Approve the request in Vana, then come back here.";
  if (type === "reading") return "Reading only what you approved…";
  if (type === "error") return "That page stayed blank. No new data was added to Lorebook.";
  return "";
}

function RuntimeDetails() {
  const [runtime, setRuntime] = useState<VanaRuntime | "invalid">({
    env: "production",
    network: "mainnet",
  });
  useEffect(() => {
    try {
      setRuntime(resolveLaunchRuntime(new URLSearchParams(window.location.search)));
    } catch {
      setRuntime("invalid");
    }
  }, []);
  if (runtime === "invalid") return <div><dt>Runtime</dt><dd>invalid</dd></div>;
  return <><div><dt>Environment</dt><dd>{runtime.env}</dd></div><div><dt>Network</dt><dd>{runtime.network}</dd></div></>;
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

function isDesktopFixtureSearch(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return resolveFixtureJourney(params) === "desktop-saved-tracks";
  } catch {
    return false;
  }
}
