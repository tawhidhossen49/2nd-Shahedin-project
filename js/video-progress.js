/* =========================================================
   video-progress.js
   ---------------------------------------------------------
   Turns the curriculum's YouTube embeds into real progress:
   watching counts, and reopening a lesson resumes where the
   student stopped instead of restarting at zero.

   How it fits together:

     · Players are created LAZILY, when a video scrolls into
       view. The curriculum is an accordion, so most iframes
       start collapsed and never load; building a player for
       all of them up front would fetch every video on the page.

     · This file NEVER writes to Supabase. It emits two events
       and js/course-progress.js persists them. That matters:
       block_progress and completed_blocks live on the same
       enrollments row, so a second writer here would race the
       checkbox path and one of the two would clobber the other.

         video-progress  { blockId, pos, dur, pct }
         video-complete  { blockId }

     · Resume position is read back through
       window.ShahedinProgress.blockProgress(blockId), which
       course-progress.js exposes from the enrollment it loaded.

   Only enrolled students have progress controls rendered, so a
   locked or preview block simply has nothing to report.
   ========================================================= */
(function () {
  "use strict";

  // Watched this far and the lesson counts as done. Deliberately not 100%:
  // end credits, outros and a student closing the tab on the last few seconds
  // should not leave a lesson stuck at "almost".
  const COMPLETE_AT = 90;
  // Seconds of playback between saves. Frequent enough that closing the tab
  // loses almost nothing, rare enough that a 40-minute lecture is a handful of
  // writes rather than two thousand.
  const SAVE_EVERY = 10;
  // Below this we treat it as "barely started" and do not offer a resume,
  // because seeking someone to 0:04 is just confusing.
  const RESUME_MIN = 15;

  let apiReady = false;
  let apiLoading = false;
  const pending = [];
  const players = new Map(); // blockId -> state

  /* ---------- YouTube IFrame API ---------- */
  function loadApi() {
    if (apiReady || apiLoading) return;
    apiLoading = true;

    // The API calls this global when it finishes loading. Chained rather than
    // overwritten so we never stomp on another script that wants the same hook.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      apiReady = true;
      if (typeof previous === "function") previous();
      pending.splice(0).forEach((fn) => fn());
    };

    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  }

  function whenReady(fn) {
    if (apiReady) fn();
    else { pending.push(fn); loadApi(); }
  }

  /* ---------- helpers ---------- */
  function savedFor(blockId) {
    const api = window.ShahedinProgress;
    return (api && typeof api.blockProgress === "function" && api.blockProgress(blockId)) || null;
  }

  function fmt(seconds) {
    const s = Math.max(0, Math.round(seconds || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  const BN = "০১২৩৪৫৬৭৮৯";
  const bn = (str) => String(str).replace(/[0-9]/g, (d) => BN[+d]);

  function paintBar(state) {
    const bar = state.bar;
    if (!bar) return;
    const pct = Math.min(100, Math.max(0, state.pct || 0));
    if (!pct) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.querySelector(".watch-fill").style.width = pct + "%";
    bar.querySelector(".watch-label").textContent =
      pct >= COMPLETE_AT
        ? "দেখা শেষ"
        : `${bn(pct)}% দেখা হয়েছে${state.dur ? ` · ${bn(fmt(state.pos))} / ${bn(fmt(state.dur))}` : ""}`;
    bar.classList.toggle("is-done", pct >= COMPLETE_AT);
  }

  function emitProgress(state) {
    document.dispatchEvent(new CustomEvent("video-progress", {
      detail: { blockId: state.blockId, pos: state.pos, dur: state.dur, pct: state.pct },
    }));
    state.savedAt = state.pos;
  }

  function tick(state) {
    const p = state.player;
    if (!p || typeof p.getCurrentTime !== "function") return;

    const pos = p.getCurrentTime() || 0;
    const dur = p.getDuration() || 0;
    if (!dur) return;

    state.pos = pos;
    state.dur = dur;
    state.pct = Math.round((pos / dur) * 100);
    paintBar(state);

    if (state.pct >= COMPLETE_AT && !state.reported) {
      state.reported = true;
      document.dispatchEvent(new CustomEvent("video-complete", { detail: { blockId: state.blockId } }));
    }
    // Seeking backwards should still save, so compare on distance travelled
    // rather than "has it advanced past the last save".
    if (Math.abs(pos - state.savedAt) >= SAVE_EVERY) emitProgress(state);
  }

  function attach(wrap) {
    const holder = wrap.closest("[data-block-id]");
    const iframe = wrap.querySelector("iframe");
    if (!holder || !iframe) return;

    const blockId = holder.dataset.blockId;
    if (!blockId || players.has(blockId)) return;

    const state = {
      blockId,
      player: null,
      pos: 0, dur: 0, pct: 0,
      savedAt: 0,
      reported: false,
      timer: null,
      bar: holder.querySelector("[data-watch-bar]"),
    };
    players.set(blockId, state);

    // Show what we already know before the player is even ready.
    const saved = savedFor(blockId);
    if (saved) {
      state.pos = Number(saved.pos) || 0;
      state.dur = Number(saved.dur) || 0;
      state.pct = Number(saved.pct) || 0;
      state.savedAt = state.pos;
      state.reported = state.pct >= COMPLETE_AT;
      paintBar(state);
    }

    whenReady(() => {
      try {
        state.player = new window.YT.Player(iframe, {
          events: {
            onReady() {
              // Resume. Not for a video that is essentially finished: dropping
              // someone at 99% just to watch the outro again is worse than
              // starting over.
              const from = state.pos;
              if (from >= RESUME_MIN && state.pct < 95 && typeof state.player.seekTo === "function") {
                state.player.seekTo(from, true);
                state.player.pauseVideo();
              }
            },
            onStateChange(e) {
              const YT = window.YT;
              if (e.data === YT.PlayerState.PLAYING) {
                clearInterval(state.timer);
                state.timer = setInterval(() => tick(state), 1000);
              } else {
                clearInterval(state.timer);
                state.timer = null;
                tick(state);
                // Pausing, ending or scrubbing away is a natural save point.
                if (state.dur) emitProgress(state);
              }
              if (e.data === YT.PlayerState.ENDED) {
                state.pct = 100;
                paintBar(state);
                if (!state.reported) {
                  state.reported = true;
                  document.dispatchEvent(new CustomEvent("video-complete", { detail: { blockId: state.blockId } }));
                }
              }
            },
          },
        });
      } catch (err) {
        // A blocked or unavailable embed must not take the lesson page with it.
        console.warn("Shahedin: couldn't attach to a YouTube player.", err);
        players.delete(blockId);
      }
    });
  }

  /* ---------- Lazy attach ---------- */
  let io = null;

  function scan() {
    // course-progress-painted fires on every repaint, so this runs often.
    // The data-yt-observed flag keeps one observer per element instead of
    // stacking a new one each time.
    const wraps = Array.from(document.querySelectorAll("[data-yt-video]:not([data-yt-observed])"));
    if (!wraps.length) return;
    wraps.forEach((w) => { w.dataset.ytObserved = "1"; });

    if (!("IntersectionObserver" in window)) {
      wraps.forEach(attach);
      return;
    }
    if (!io) {
      // A collapsed accordion row has no height, so it never intersects and no
      // player is built for it: exactly the behaviour we want, since building
      // one would fetch a video nobody opened.
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            io.unobserve(entry.target);
            attach(entry.target);
          });
        },
        { threshold: 0.1 }
      );
    }
    wraps.forEach((w) => io.observe(w));
  }

  /* ---------- Save on the way out ---------- */
  // pagehide covers tab close, navigation and mobile backgrounding, where
  // beforeunload is unreliable. visibilitychange catches app switching.
  function flush() {
    players.forEach((state) => {
      if (state.dur && Math.abs(state.pos - state.savedAt) >= 1) emitProgress(state);
    });
  }
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

  /* Curriculum HTML is mounted by render.js after the course data arrives, so
     wait for that rather than DOMContentLoaded. course-progress-painted fires
     once the enrollment is known, which is when resume positions exist. */
  document.addEventListener("course-mounted", scan);
  document.addEventListener("course-progress-painted", scan);
})();
