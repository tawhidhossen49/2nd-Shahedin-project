/* =========================================================
   motion.js
   ---------------------------------------------------------
   The site's motion language, beyond the single fade-up that
   js/main.js drives through .reveal / .inview:

     · staggered group entrances   (.reveal-stagger)
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
      parallax, no exceptions.
   4. Anything it can't find, it skips. No page depends on it.

   Deliberately NOT here: the stat number count-up that used to
   run on .hero-stat b / .trust-item .num / .stat-mini .n /
   .case-result / .kit-stat-card .n. It read the figure out of
   the DOM, animated toward it, and wrote the snapshot back on
   the final frame — but js/home-content.js fills those same
   elements from Supabase asynchronously. Whichever finished
   last won, so a stat showed the admin-panel value or the
   hard-coded HTML fallback depending on network timing, and
   changed between reloads. The stats are CMS data, not decoration:
   they now render once, from the database, and stay put.
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
     2. Parallax
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
     3. Scroll progress rail  (.read-progress > span)
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
     4. Press feedback on cards — pointer only, no layout cost
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
  });
})();
