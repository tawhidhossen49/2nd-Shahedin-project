/* =========================================================
   motion.js
   ---------------------------------------------------------
   The site's motion language, beyond the single fade-up that
   js/main.js drives through .reveal / .inview:

     · staggered group entrances   (.reveal-stagger)
     · number counters on the stat blocks
     · scroll parallax on the hero and footer portraits
     · a scroll-progress rail on long pages
     · chart bars that grow when their section arrives

   Rules this file follows, deliberately:

   1. transform and opacity ONLY. Nothing here animates width,
      height, top or left, so nothing triggers layout.
   2. One rAF loop, one passive scroll listener, shared by every
      scroll-driven effect. No per-element listeners.
   3. prefers-reduced-motion: reduce turns all of it off and
      jumps every element straight to its final state — no
      counters, no parallax, no exceptions.
   4. Anything it can't find, it skips. No page depends on it.
   ========================================================= */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const supportsIO = "IntersectionObserver" in window;

  /* ---------------------------------------------------------
     Shared scroll loop
     --------------------------------------------------------- */
  const scrollTasks = [];
  let ticking = false;

  function onScroll() {
    if (ticking || !scrollTasks.length) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY || window.pageYOffset;
      const vh = window.innerHeight;
      for (let i = 0; i < scrollTasks.length; i++) scrollTasks[i](y, vh);
      ticking = false;
    });
  }

  function addScrollTask(fn) {
    scrollTasks.push(fn);
    if (scrollTasks.length === 1) {
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
    }
    fn(window.scrollY || window.pageYOffset, window.innerHeight);
  }

  /* ---------------------------------------------------------
     1. Group entrances — .reveal-stagger
     main.js already observes .reveal; this covers containers
     whose CHILDREN stagger, plus chart containers.
     --------------------------------------------------------- */
  function initStagger() {
    const groups = document.querySelectorAll(".reveal-stagger, .bar-chart, .audience-bars, .timeline-h");
    if (!groups.length) return;
    if (!supportsIO || reduceMotion.matches) {
      groups.forEach((el) => el.classList.add("inview"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("inview");
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -30px 0px" }
    );
    groups.forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------
     2. Number counters
     Reads whatever the element ends up displaying — including
     values Supabase writes in later — and counts up to it while
     preserving any prefix/suffix ("৳", "M", "+", "%", "/5").
     Bangla digits in, Bangla digits out.
     --------------------------------------------------------- */
  const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  const bnToLatin = (s) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  const latinToBn = (s) => s.replace(/[0-9]/g, (d) => BN_DIGITS[+d]);

  function parseCountable(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const hadBangla = /[০-৯]/.test(raw);
    const normalized = bnToLatin(raw).replace(/,/g, "");
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const value = parseFloat(match[0]);
    if (!isFinite(value)) return null;
    const idx = normalized.indexOf(match[0]);
    return {
      value,
      decimals: (match[0].split(".")[1] || "").length,
      grouped: /,/.test(bnToLatin(raw)),
      prefix: normalized.slice(0, idx),
      suffix: normalized.slice(idx + match[0].length),
      bangla: hadBangla,
    };
  }

  function formatCount(n, spec) {
    let body = spec.decimals ? n.toFixed(spec.decimals) : String(Math.round(n));
    if (spec.grouped) {
      const parts = body.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      body = parts.join(".");
    }
    const out = spec.prefix + body + spec.suffix;
    return spec.bangla ? latinToBn(out) : out;
  }

  function runCounter(el) {
    const spec = parseCountable(el.textContent);
    if (!spec) return;
    const finalText = el.textContent;
    const duration = 1100;
    const start = performance.now();
    // Reserve the final width so the count-up can't reflow its neighbours.
    el.style.display = el.style.display || "inline-block";
    el.style.minInlineSize = el.getBoundingClientRect().width + "px";

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo — fast out of the gate, long settle.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      el.textContent = formatCount(spec.value * eased, spec);
      if (t < 1) requestAnimationFrame(frame);
      else el.textContent = finalText;
    }
    requestAnimationFrame(frame);
  }

  function initCounters() {
    const targets = document.querySelectorAll(
      ".hero-stat b, .trust-item .num, .stat-mini .n, .case-result, .kit-stat-card .n"
    );
    if (!targets.length || !supportsIO || reduceMotion.matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          io.unobserve(entry.target);
          runCounter(entry.target);
        });
      },
      { threshold: 0.6 }
    );
    targets.forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------
     3. Parallax
     Applied to the hero portrait and the footer cutout. The CSS
     also declares a scroll-driven version for browsers with
     animation-timeline; this is the fallback and stays cheap:
     one transform per frame, capped at +/- 26px.
     --------------------------------------------------------- */
  function initParallax() {
    if (reduceMotion.matches) return;
    if (!window.matchMedia("(min-width: 761px)").matches) return;

    const layers = [];
    document.querySelectorAll("[data-parallax]").forEach((el) => {
      const depth = parseFloat(el.getAttribute("data-parallax")) || 0.12;
      layers.push({ el, depth });
    });
    if (!layers.length) return;

    addScrollTask((y, vh) => {
      for (let i = 0; i < layers.length; i++) {
        const { el, depth } = layers[i];
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > vh + 200) continue;
        const progress = (vh - rect.top) / (vh + rect.height) - 0.5;
        const offset = Math.max(-26, Math.min(26, progress * depth * 200));
        el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
      }
    });
  }

  /* ---------------------------------------------------------
     4. Scroll progress rail  (.read-progress > span)
     --------------------------------------------------------- */
  function initReadProgress() {
    const bar = document.querySelector(".read-progress span");
    if (!bar) return;
    addScrollTask((y) => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const pct = max > 0 ? Math.min(1, y / max) : 0;
      bar.style.transform = `scaleX(${pct.toFixed(4)})`;
    });
  }

  /* ---------------------------------------------------------
     5. Press feedback on cards — pointer only, no layout cost
     --------------------------------------------------------- */
  function initPressFeedback() {
    if (reduceMotion.matches) return;
    document.addEventListener(
      "pointerdown",
      (e) => {
        const card = e.target.closest(".card, .partner-card, .case-card, .res-row");
        if (!card) return;
        card.style.transition = "transform 120ms cubic-bezier(0.22,0.9,0.3,1)";
        card.style.transform = "scale(0.988)";
        const release = () => {
          card.style.transform = "";
          card.style.transition = "";
          window.removeEventListener("pointerup", release);
          window.removeEventListener("pointercancel", release);
        };
        window.addEventListener("pointerup", release);
        window.addEventListener("pointercancel", release);
      },
      { passive: true }
    );
  }

  /* --------------------------------------------------------- */
  function init() {
    initStagger();
    initCounters();
    initParallax();
    initReadProgress();
    initPressFeedback();
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(init);
  // Content that arrives later (render.js mounts, Supabase copy) gets the
  // same treatment without re-running the scroll wiring.
  document.addEventListener("contentready", () => {
    initStagger();
    initCounters();
  });
})();
