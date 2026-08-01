/* =========================================================
   video-facade.js — click-to-load video component (brief 2.4)
   ---------------------------------------------------------
   The site used to inject <iframe src="youtube.com/embed/...">
   straight into the page, so YouTube's own chrome, thumbnail
   and tracking scripts rendered inside our layout and undid
   the design around them.

   This replaces that with a poster in OUR frame — our radius,
   our border, our scrim, our accent play button, our type for
   the duration badge and the locked / coming-soon states. The
   real iframe is only created on click.

   Consequences worth naming:
     · no YouTube script runs until the visitor asks for one,
       so first paint drops three third-party requests
     · the poster comes from i.ytimg.com, a plain image CDN,
       not from the tracking-bearing embed
     · the control is a real <button>, so it is reachable by
       keyboard and announces itself in Bangla

   Exposes window.VideoFacade. No dependencies, no build step.
   ========================================================= */
(function () {
  "use strict";

  var BN = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  function bn(s) {
    return String(s == null ? "" : s).replace(/[0-9]/g, function (d) { return BN[+d]; });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  /* Accepts a full URL or a bare id. Mirrors the matcher already in
     render.js so both files agree on what counts as a video. */
  function videoId(urlOrId) {
    if (!urlOrId) return "";
    var s = String(urlOrId);
    if (/^[a-zA-Z0-9_-]{6,15}$/.test(s)) return s;
    var m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,15})/);
    return m ? m[1] : "";
  }

  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  var ICON_SOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/><path d="M2 2l20 20"/></svg>';

  /* Poster: maxresdefault is the sharp one but is missing on plenty of
     uploads, so it falls back to hqdefault on error. hqdefault is 4:3 with
     letterbox bars, which object-fit:cover crops back to 16:9. */
  function posterHTML(id, image, alt) {
    if (image) {
      return '<img class="vfacade-img" src="' + esc(image) + '" alt="' + esc(alt) + '" loading="lazy" decoding="async">';
    }
    if (!id) return "";
    return (
      '<img class="vfacade-img" src="https://i.ytimg.com/vi/' + esc(id) + '/maxresdefault.jpg"' +
      ' alt="' + esc(alt) + '" loading="lazy" decoding="async"' +
      ' onerror="this.onerror=null;this.src=\'https://i.ytimg.com/vi/' + esc(id) + '/hqdefault.jpg\'">'
    );
  }

  /* opts: { url|id, title, image, duration, state, caption, ratio }
     state: "ready" (default) | "locked" | "soon"                         */
  function html(opts) {
    var o = opts || {};
    var id = videoId(o.url || o.id);
    var title = o.title || "";
    var state = o.state || (id ? "ready" : "soon");
    var ratio = o.ratio || "16/9";
    var styleAttr = ' style="--vf-ratio:' + esc(ratio) + '"';

    if (state === "locked") {
      return (
        '<div class="vfacade is-locked"' + styleAttr + '>' +
          '<div class="vfacade-stage">' +
            posterHTML(id, o.image, title) +
            '<span class="vfacade-scrim"></span>' +
            '<span class="vfacade-state">' + ICON_LOCK + '</span>' +
          '</div>' +
          '<p class="vfacade-cap">' + ICON_LOCK +
            '<span>' + esc(o.caption || "কোর্সে ভর্তি হলে সম্পূর্ণ কারিকুলামের ভিডিও দেখতে পারবেন।") + '</span></p>' +
        '</div>'
      );
    }

    if (state === "soon" || !id) {
      return (
        '<div class="vfacade is-soon"' + styleAttr + '>' +
          '<div class="vfacade-stage">' +
            '<span class="vfacade-state">' + ICON_SOON + '</span>' +
          '</div>' +
          '<p class="vfacade-cap">' + ICON_SOON +
            '<span>' + esc(o.caption || "ভিডিও শীঘ্রই যোগ করা হবে।") + '</span></p>' +
        '</div>'
      );
    }

    return (
      '<div class="vfacade" data-vfacade data-video-id="' + esc(id) + '"' + styleAttr + '>' +
        '<button type="button" class="vfacade-stage vfacade-btn" ' +
          'aria-label="ভিডিও চালান: ' + esc(title || "কোর্স প্রিভিউ") + '">' +
          posterHTML(id, o.image, title) +
          '<span class="vfacade-scrim"></span>' +
          '<span class="vfacade-play">' + ICON_PLAY + '</span>' +
          (o.duration ? '<span class="vfacade-dur">' + esc(bn(o.duration)) + '</span>' : "") +
        '</button>' +
        (title ? '<p class="vfacade-cap"><span>' + esc(title) + '</span></p>' : "") +
      '</div>'
    );
  }

  /* Swap the poster for the real player. autoplay=1 is correct here because
     the visitor just clicked — it is a response, not an ambush. */
  function play(wrap) {
    if (!wrap || wrap.dataset.vfLoaded) return;
    var id = wrap.getAttribute("data-video-id");
    if (!id) return;
    wrap.dataset.vfLoaded = "1";
    var label = "";
    var btn = wrap.querySelector(".vfacade-btn");
    if (btn) label = btn.getAttribute("aria-label") || "";
    var stage = wrap.querySelector(".vfacade-stage");
    if (!stage) return;

    var frame = document.createElement("iframe");
    frame.className = "vfacade-iframe";
    frame.src =
      "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) +
      "?autoplay=1&rel=0&modestbranding=1&playsinline=1";
    frame.title = label || "ভিডিও প্লেয়ার";
    frame.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("tabindex", "0");

    stage.replaceWith(frame);
    wrap.classList.add("is-playing");
    // Move focus into the player so keyboard users land where they asked to be.
    frame.focus({ preventScroll: true });
  }

  /* One delegated listener for the whole document, so facades that render
     later (Supabase copy, render.js mounts, the YouTube fetch) need no
     re-wiring. Enter/Space come free because the control is a <button>. */
  function init() {
    if (document.documentElement.dataset.vfWired) return;
    document.documentElement.dataset.vfWired = "1";
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".vfacade-btn") : null;
      if (!btn) return;
      e.preventDefault();
      play(btn.closest("[data-vfacade]"));
    });
  }

  window.VideoFacade = { html: html, play: play, videoId: videoId, init: init };

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
