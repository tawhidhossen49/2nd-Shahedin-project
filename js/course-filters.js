/* =========================================================
   course-filters.js — the "Search Filters" drawer on courses.html
   ---------------------------------------------------------
   Owns only the UI. The matching logic lives in js/main.js and is
   shared with the price chips, the search box and store.html —
   this file never decides what a match is, it only reads the
   drawer's controls and hands them to window.ShahedinFilters.

   Why the drawer keeps its own pending state: Apply(N) has to
   report how many courses WOULD match before the visitor commits,
   while the grid behind it still shows the committed selection.
   So toggling a switch recounts but does not repaint; Apply
   promotes the pending selection into ShahedinFilters.state and
   repaints once.

   Dismissal follows the mobile menu in js/main.js — Escape, a
   backdrop click, the close button, focus moved in on open and
   returned to the trigger on close, and Tab trapped inside while
   it is open, since the panel covers the page.
   ========================================================= */
(function () {
  "use strict";

  var FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

  var TYPES = [
    { value: "all", label: "সব" },
    { value: "career_track", label: "ক্যারিয়ার ট্র্যাক" },
    { value: "foundation", label: "ফাউন্ডেশন কোর্স" },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  var BN = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  function bn(v) { return String(v).replace(/[0-9]/g, function (d) { return BN[+d]; }); }

  function label(slug) {
    if (window.ShahedinRender && typeof window.ShahedinRender.categoryLabel === "function") {
      return window.ShahedinRender.categoryLabel(slug);
    }
    return slug;
  }

  /* Categories come from the cards actually on the page, not from SITE_DATA,
     so the list can never offer a category with nothing behind it. */
  function categoriesOnPage() {
    var seen = [];
    document.querySelectorAll("[data-filterable][data-category]").forEach(function (c) {
      var v = c.dataset.category;
      if (v && seen.indexOf(v) === -1) seen.push(v);
    });
    return seen.sort(function (a, b) { return label(a).localeCompare(label(b), "bn"); });
  }

  function build(trigger) {
    var cats = categoriesOnPage();
    var wrap = document.createElement("div");
    wrap.className = "fdrawer";
    wrap.id = "courseFilterDrawer";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "fdrawerTitle");
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML =
      '<div class="fdrawer-backdrop" data-fclose></div>' +
      '<div class="fdrawer-panel" role="document">' +
        '<div class="fdrawer-head">' +
          '<h2 id="fdrawerTitle">সার্চ ফিল্টার</h2>' +
          '<button type="button" class="icon-btn" data-fclose aria-label="ফিল্টার প্যানেল বন্ধ করুন">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="fdrawer-body">' +
          '<section class="fdrawer-sec">' +
            '<h3 class="fdrawer-h">কোর্সের ধরন</h3>' +
            '<div class="fdrawer-chips" role="group" aria-label="কোর্সের ধরন">' +
              TYPES.map(function (t, i) {
                return '<button type="button" class="chip' + (i === 0 ? " active" : "") +
                  '" data-ftype="' + esc(t.value) + '" aria-pressed="' + (i === 0) + '">' + esc(t.label) + "</button>";
              }).join("") +
            "</div>" +
          "</section>" +
          '<section class="fdrawer-sec">' +
            '<h3 class="fdrawer-h">ক্যাটাগরি</h3>' +
            '<div class="search-input-wrap fdrawer-find">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
              '<label class="visually-hidden" for="fcatFind">ক্যাটাগরির তালিকা ছেঁকে দেখুন</label>' +
              '<input type="search" id="fcatFind" class="search-input" data-fcat-find placeholder="ক্যাটাগরি খুঁজুন...">' +
            "</div>" +
            '<ul class="fdrawer-list" data-fcat-list>' +
              cats.map(function (c) {
                return '<li class="fdrawer-row" data-fcat-row="' + esc(label(c).toLowerCase()) + '">' +
                  '<label class="fswitch">' +
                    '<input type="checkbox" data-fcat="' + esc(c) + '">' +
                    '<span class="fswitch-track" aria-hidden="true"></span>' +
                    '<span class="fswitch-label">' + esc(label(c)) + "</span>" +
                  "</label></li>";
              }).join("") +
            "</ul>" +
            '<p class="small-note" data-fcat-none hidden>এই নামে কোনো ক্যাটাগরি নেই।</p>' +
          "</section>" +
        "</div>" +
        '<div class="fdrawer-foot">' +
          '<button type="button" class="btn btn-ghost" data-fclear>সব মুছুন</button>' +
          '<button type="button" class="btn btn-primary" data-fapply>প্রয়োগ করুন (<span data-fcount>০</span>)</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(wrap);
    return wrap;
  }

  function init() {
    var trigger = document.getElementById("courseFilterBtn");
    var grid = document.querySelector("[data-mount='course-grid']");
    if (!trigger || !grid || !window.ShahedinFilters) return;
    if (document.getElementById("courseFilterDrawer")) return;   // already built
    if (!document.querySelector("[data-filterable]")) return;     // cards not mounted yet

    var drawer = build(trigger);
    var panel = drawer.querySelector(".fdrawer-panel");
    var countEl = drawer.querySelector("[data-fcount]");
    var badge = trigger.querySelector("[data-filter-count]");
    var lastFocus = null;

    function pending() {
      var typeBtn = drawer.querySelector(".chip.active[data-ftype]");
      var cats = [];
      drawer.querySelectorAll("[data-fcat]:checked").forEach(function (i) { cats.push(i.dataset.fcat); });
      return { courseType: typeBtn ? typeBtn.dataset.ftype : "all", categories: cats };
    }

    function activeCount(sel) {
      return (sel.courseType !== "all" ? 1 : 0) + sel.categories.length;
    }

    /* Recount without repainting: the grid keeps showing what was committed. */
    function refreshCount() {
      var sel = pending();
      var n = window.ShahedinFilters.count(window.ShahedinFilters.build(sel));
      countEl.textContent = bn(n);
    }

    function paintBadge() {
      var n = activeCount(window.ShahedinFilters.state);
      if (!badge) return;
      badge.textContent = bn(n);
      badge.hidden = n === 0;
      trigger.classList.toggle("has-filters", n > 0);
    }

    function open() {
      lastFocus = document.activeElement;
      drawer.classList.add("open");
      drawer.setAttribute("aria-hidden", "false");
      trigger.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      refreshCount();
      var first = panel.querySelector(FOCUSABLE);
      if (first) first.focus();
    }

    function close() {
      drawer.classList.remove("open");
      drawer.setAttribute("aria-hidden", "true");
      trigger.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      else trigger.focus();
    }

    trigger.addEventListener("click", open);
    drawer.addEventListener("click", function (e) {
      if (e.target.closest("[data-fclose]")) close();
    });

    // Course type is single-select, same chip pattern the price row uses.
    drawer.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-ftype]");
      if (!chip) return;
      drawer.querySelectorAll("[data-ftype]").forEach(function (c) {
        var on = c === chip;
        c.classList.toggle("active", on);
        c.setAttribute("aria-pressed", String(on));
      });
      refreshCount();
    });

    drawer.addEventListener("change", function (e) {
      if (e.target.matches("[data-fcat]")) refreshCount();
    });

    /* This only hides rows from the list. It is not a second search over the
       courses — the course search box in the filter bar is unaffected. */
    var find = drawer.querySelector("[data-fcat-find]");
    var none = drawer.querySelector("[data-fcat-none]");
    if (find) {
      find.addEventListener("input", function () {
        var q = find.value.trim().toLowerCase();
        var shown = 0;
        drawer.querySelectorAll("[data-fcat-row]").forEach(function (row) {
          var hit = !q || row.dataset.fcatRow.indexOf(q) !== -1;
          row.hidden = !hit;
          if (hit) shown++;
        });
        if (none) none.hidden = shown > 0;
      });
    }

    drawer.querySelector("[data-fapply]").addEventListener("click", function () {
      var sel = pending();
      window.ShahedinFilters.state.courseType = sel.courseType;
      window.ShahedinFilters.state.categories = sel.categories;
      window.ShahedinFilters.apply();
      paintBadge();
      close();
    });

    drawer.querySelector("[data-fclear]").addEventListener("click", function () {
      drawer.querySelectorAll("[data-ftype]").forEach(function (c, i) {
        c.classList.toggle("active", i === 0);
        c.setAttribute("aria-pressed", String(i === 0));
      });
      drawer.querySelectorAll("[data-fcat]").forEach(function (i) { i.checked = false; });
      if (find) { find.value = ""; find.dispatchEvent(new Event("input")); }
      window.ShahedinFilters.state.courseType = "all";
      window.ShahedinFilters.state.categories = [];
      window.ShahedinFilters.apply();
      paintBadge();
      refreshCount();
    });

    document.addEventListener("keydown", function (e) {
      if (!drawer.classList.contains("open")) return;
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      var items = Array.from(panel.querySelectorAll(FOCUSABLE)).filter(function (el) {
        return el.offsetParent !== null;
      });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    paintBadge();
  }

  // render.js fires this once the catalogue cards are mounted.
  document.addEventListener("contentready", init);
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
