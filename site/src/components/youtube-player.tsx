"use client";

import { useEffect, useRef } from "react";

/**
 * The audio engine behind the mini player.
 *
 * The site's player is a custom piece of design, so YouTube is used only as the
 * playback engine: an offscreen IFrame API player that nobody sees, driven by
 * the store. Nothing here renders visible UI.
 *
 * Why YouTube: Spotify embeds replace the player with Spotify's own chrome,
 * full Spotify playback needs a logged-in Premium listener, and the 30 second
 * preview_url was withdrawn for new apps. YouTube plays for everyone, free,
 * with no login.
 */

/* ------------------------------------------------------------------ *
 * Minimal typings. @types/youtube is not installed and this component
 * touches a small, stable corner of the API, so the surface is declared
 * here rather than pulling in a dependency.
 * ------------------------------------------------------------------ */

type YTPlayer = {
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  cueVideoById: (videoId: string, startSeconds?: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setVolume: (volume: number) => void;
  unMute: () => void;
  destroy: () => void;
};

type YTEvent = { target: YTPlayer };
type YTDataEvent = { target: YTPlayer; data: number };

type YTNamespace = {
  Player: new (
    host: HTMLElement | string,
    options: {
      width?: number | string;
      height?: number | string;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: YTEvent) => void;
        onStateChange?: (event: YTDataEvent) => void;
        onError?: (event: YTDataEvent) => void;
        onAutoplayBlocked?: (event: YTEvent) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Numeric player states, per the IFrame API reference. */
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;

const SCRIPT_ID = "youtube-iframe-api";
const SCRIPT_SRC = "https://www.youtube.com/iframe_api";

/**
 * One load per document, shared by every caller. The promise lives at module
 * scope, so React 19's double-invoked effects in development reuse it instead
 * of injecting the script twice. A failure clears the cache so a later play can
 * try again.
 */
let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  const pending = new Promise<YTNamespace>((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      reject(new Error("The YouTube IFrame API needs a browser."));
      return;
    }
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    // The API calls this global once it has finished parsing. Chain rather than
    // clobber, in case anything else on the page is waiting on the same hook.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("The YouTube IFrame API loaded without a player."));
    };

    if (!document.getElementById(SCRIPT_ID)) {
      const tag = document.createElement("script");
      tag.id = SCRIPT_ID;
      tag.src = SCRIPT_SRC;
      tag.async = true;
      tag.onerror = () =>
        reject(new Error("The YouTube IFrame API failed to load."));
      document.head.appendChild(tag);
    }
  });

  apiPromise = pending;
  pending.catch(() => {
    if (apiPromise === pending) apiPromise = null;
  });
  return pending;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Accepts a bare video id or any of the YouTube URL shapes and returns the id,
 * or null when there is nothing playable. Callers can hand over whichever of
 * the two the catalogue happens to hold.
 */
export function youtubeVideoId(input?: string | null): string | null {
  if (!input) return null;
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return VIDEO_ID.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && VIDEO_ID.test(v)) return v;
    const match = url.pathname.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    if (match) return match[1];
  }
  return null;
}

function messageForErrorCode(code: number): string {
  switch (code) {
    case 2:
      return "That track link is not valid.";
    case 5:
      return "This browser could not play that track.";
    case 100:
      return "That track is no longer available.";
    case 101:
    case 150:
      return "The owner does not allow this track to play here.";
    default:
      return "That track could not be played.";
  }
}

type Want = { videoId: string | null; playing: boolean };

/**
 * Push the store's intent into the player. Called on every change and again
 * once the player reports ready, so a click that lands before the iframe is up
 * is not lost.
 */
function apply(
  player: YTPlayer,
  want: Want,
  loadedId: { current: string | null },
) {
  const { videoId, playing } = want;

  if (!videoId) {
    if (loadedId.current) {
      player.pauseVideo();
      loadedId.current = null;
    }
    return;
  }

  if (loadedId.current !== videoId) {
    loadedId.current = videoId;
    if (playing) player.loadVideoById(videoId);
    else player.cueVideoById(videoId);
    return;
  }

  const state = player.getPlayerState();
  if (playing) {
    if (state !== PLAYING && state !== BUFFERING) player.playVideo();
  } else if (state === PLAYING || state === BUFFERING) {
    player.pauseVideo();
  }
}

export type YouTubeEngineProps = {
  /** Video id to hold loaded. null pauses and releases the current track. */
  videoId: string | null;
  /** What the UI wants. The player reports back what actually happened. */
  playing: boolean;
  /** Fired from the player's own state changes, never from a timer. */
  onPlayingChange: (playing: boolean) => void;
  onEnded: () => void;
  onProgress: (position: number, duration: number) => void;
  onError: (message: string) => void;
};

/** How often the playhead is read back while a track runs. */
const POLL_MS = 250;

export function YouTubeEngine({
  videoId,
  playing,
  onPlayingChange,
  onEnded,
  onProgress,
  onError,
}: YouTubeEngineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);
  const wantRef = useRef<Want>({ videoId, playing });

  // The player is built once, so its event handlers would otherwise close over
  // the first render's callbacks. Keep the live ones in a ref instead.
  const callbacksRef = useRef({ onPlayingChange, onEnded, onProgress, onError });
  useEffect(() => {
    callbacksRef.current = { onPlayingChange, onEnded, onProgress, onError };
  });

  // Build the player once, tear it down on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let player: YTPlayer | null = null;

    // The API replaces this node with the iframe, so it is created fresh per
    // effect run. That keeps a double-invoked effect from handing YouTube a
    // node that a previous destroy() already removed.
    const mount = document.createElement("div");
    host.appendChild(mount);

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) return;
        player = new YT.Player(mount, {
          width: 320,
          height: 180,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              readyRef.current = true;
              event.target.unMute();
              event.target.setVolume(100);
              // Catch up with whatever was asked for while the iframe loaded.
              apply(event.target, wantRef.current, loadedIdRef);
            },
            onStateChange: (event) => {
              const callbacks = callbacksRef.current;
              const state = event.data;
              if (state === PLAYING) {
                callbacks.onPlayingChange(true);
                callbacks.onProgress(
                  event.target.getCurrentTime(),
                  event.target.getDuration(),
                );
              } else if (state === PAUSED) {
                callbacks.onPlayingChange(false);
                callbacks.onProgress(
                  event.target.getCurrentTime(),
                  event.target.getDuration(),
                );
              } else if (state === ENDED) {
                callbacks.onEnded();
              }
              // BUFFERING, CUED and UNSTARTED make no claim about playback.
            },
            onError: (event) => {
              callbacksRef.current.onError(messageForErrorCode(event.data));
            },
            onAutoplayBlocked: () => {
              // The browser refused the play. Say so rather than showing a
              // player that pretends to be running.
              callbacksRef.current.onPlayingChange(false);
            },
          },
        });
        playerRef.current = player;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        callbacksRef.current.onError(
          error instanceof Error ? error.message : "The player failed to load.",
        );
      });

    return () => {
      cancelled = true;
      readyRef.current = false;
      playerRef.current = null;
      loadedIdRef.current = null;
      try {
        player?.destroy();
      } catch {
        // destroy() throws if the iframe is already gone. Nothing to do.
      }
      mount.remove();
    };
  }, []);

  // Track and transport changes.
  useEffect(() => {
    wantRef.current = { videoId, playing };
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    apply(player, wantRef.current, loadedIdRef);
  }, [videoId, playing]);

  // Real playhead, read from the player.
  useEffect(() => {
    const read = () => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      const position = player.getCurrentTime();
      const duration = player.getDuration();
      if (Number.isFinite(position)) {
        callbacksRef.current.onProgress(
          position,
          Number.isFinite(duration) ? duration : 0,
        );
      }
    };

    read();
    if (!playing || !videoId) return;
    const timer = window.setInterval(read, POLL_MS);
    return () => window.clearInterval(timer);
  }, [playing, videoId]);

  // Offscreen rather than display:none, at a size YouTube is happy to play at.
  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none fixed left-[-9999px] top-0 h-[180px] w-[320px]"
    />
  );
}
