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

   This file also runs the player's buttons. YouTube's own are
   switched off (see contentBlockBodyHTML in render.js), so play,
   seek, sound, speed and full screen here all go through the
   same YT.Player that measures progress.
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

  /* ---------- The player's buttons ---------- */
  const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

  function paintControls(state) {
    const el = state.wrap;
    if (!el) return;
    const p = state.player;
    const s = p && typeof p.getPlayerState === "function" ? p.getPlayerState() : -1;
    const playing = s === 1 || s === 3;
    el.classList.toggle("is-playing", playing);
    el.classList.toggle("is-paused", s === 2);
    el.classList.toggle("is-ended", s === 0);
    if (playing) {
      state.started = true;
      el.classList.remove("is-new", "needs-tap");
      el.querySelector(".vp-hint").hidden = true;
    }
    if (p && typeof p.getCurrentTime === "function" && !state.dragging) {
      state.now = p.getCurrentTime() || 0;
      state.total = p.getDuration() || state.dur || 0;
    }
    el.querySelector("[data-vp-now]").textContent = fmt(state.now);
    el.querySelector("[data-vp-total]").textContent = fmt(state.total);
    if (!state.dragging) {
      const seek = el.querySelector(".vp-seek");
      seek.value = state.total ? Math.round((state.now / state.total) * 1000) : 0;
      seek.style.setProperty("--at", (state.total ? (state.now / state.total) * 100 : 0) + "%");
    }
    if (p && typeof p.isMuted === "function") el.classList.toggle("is-muted", p.isMuted());
    el.querySelector('[data-vp="play"]').setAttribute("aria-label", playing ? "থামান" : "চালান");
  }

  /* Some phones only start a cross-origin video from a touch on the video
     itself. If play did not take, one small square over YouTube's own play
     button is opened for that single tap; the rest stays covered. It also
     rescues a player whose API never loaded, so a video is never unplayable. */
  function offerTap(state) {
    setTimeout(() => {
      if (state.started) return;
      state.wrap.classList.add("needs-tap");
      state.wrap.querySelector(".vp-hint").hidden = false;
    }, 1800);
  }

  function wireControls(state) {
    const el = state.wrap;
    const seek = el.querySelector(".vp-seek");
    const player = () => (state.player && typeof state.player.playVideo === "function" ? state.player : null);

    const play = () => {
      const p = player();
      if (p) p.playVideo();
      offerTap(state);
    };
    const toggle = () => {
      const p = player();
      const s = p ? p.getPlayerState() : -1;
      if (s === 1 || s === 3) p.pauseVideo();
      else if (s === 0) { p.seekTo(0, true); p.playVideo(); }
      else play();
    };
    const jump = (to) => {
      const p = player();
      if (!p) return;
      p.seekTo(Math.max(0, Math.min(state.total || to, to)), true);
      paintControls(state);
    };

    // Full screen; where a browser has none for a page (iPhone), the player
    // fills the window instead.
    const fill = (on) => {
      el.classList.toggle("is-full", on);
      document.documentElement.classList.toggle("vp-open", on);
    };
    const full = () => {
      if (el.classList.contains("is-full")) return fill(false);
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }
      const ask = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!ask) return fill(true);
      const going = ask.call(el);
      if (going && going.catch) going.catch(() => fill(true));
    };

    el.querySelector(".vp-shield").addEventListener("click", toggle);
    el.querySelector(".vp-shield").addEventListener("dblclick", full);
    el.querySelector(".vp-big").addEventListener("click", toggle);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-vp]");
      if (!b) return;
      const p = player();
      const k = b.dataset.vp;
      if (k === "play") toggle();
      else if (k === "full") full();
      else if (k === "mute" && p) { if (p.isMuted()) p.unMute(); else p.mute(); el.classList.toggle("is-muted"); }
      else if (k === "speed" && p) {
        state.rate = SPEEDS[(SPEEDS.indexOf(state.rate) + 1) % SPEEDS.length];
        p.setPlaybackRate(state.rate);
        b.textContent = state.rate + "×";
      }
    });
    seek.addEventListener("input", () => {
      state.dragging = true;
      state.now = (seek.value / 1000) * state.total;
      seek.style.setProperty("--at", seek.value / 10 + "%");
      el.querySelector("[data-vp-now]").textContent = fmt(state.now);
    });
    seek.addEventListener("change", () => {
      state.dragging = false;
      jump((seek.value / 1000) * state.total);
    });
    el.addEventListener("keydown", (e) => {
      if (e.target.matches("input")) return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); jump(state.now + 5); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); jump(state.now - 5); }
      else if (e.key === "f") full();
      else if (e.key === "Escape" && el.classList.contains("is-full")) fill(false);
    });
    // Nothing to right-click ("copy video URL") on the picture.
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    // The buttons fade while it plays, and come back on a move or a touch.
    let idle;
    const wake = () => {
      el.classList.remove("is-idle");
      clearTimeout(idle);
      idle = setTimeout(() => el.classList.add("is-idle"), 2600);
    };
    ["pointermove", "pointerdown", "keydown", "focusin"].forEach((t) => el.addEventListener(t, wake));
    wake();
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
    paintControls(state);

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
      wrap,
      now: 0, total: 0,
      rate: 1,
      started: false,
      dragging: false,
    };
    players.set(blockId, state);
    wireControls(state);

    // Show what we already know before the player is even ready.
    const saved = savedFor(blockId);
    if (saved) {
      state.pos = Number(saved.pos) || 0;
      state.dur = Number(saved.dur) || 0;
      state.pct = Number(saved.pct) || 0;
      state.savedAt = state.pos;
      state.reported = state.pct >= COMPLETE_AT;
      state.now = state.pos;
      state.total = state.dur;
      paintBar(state);
      paintControls(state);
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
              paintControls(state);
            },
            onStateChange(e) {
              const YT = window.YT;
              paintControls(state);
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
        wrap.classList.add("needs-tap");
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
