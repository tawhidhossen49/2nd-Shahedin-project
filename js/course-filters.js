/* =========================================================
   course-filters.js — the catalogue filter rail on courses.html
   ---------------------------------------------------------
   The rail's markup is static in courses.html; this file only
   fills in the category list and wires the controls. Matching
   logic lives in js/main.js and is shared with the price chips,
   the search box and store.html — nothing here decides what a
   match is.

   ONE panel, two presentations. On desktop .catalog-side is a
   column in the page grid and filters apply the moment a box is
   ticked, which is what the reference layout does. Below 1080 the
   same element becomes a slide-in drawer over a backdrop, opened
   by the toolbar button; there the footer's "ফলাফল দেখুন" simply
   closes it, because the results underneath have already updated.

   Dismissal follows the mobile menu in js/main.js — Escape, a
   backdrop tap, the close button, and focus returned to the
   trigger.
   ========================================================= */
(function () {
  "use strict";

  var BN = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  function bn(v) { return String(v).replace(/[0-9]/g, function (d) { return BN[+d]; }); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  function label(slug) {
    if (window.ShahedinRender && typeof window.ShahedinRender.categoryLabel === "function") {
      return window.ShahedinRender.categoryLabel(slug);
    }
    return slug;
  }

  /* Categories come from the cards actually on the page, so the rail can never
     offer one with nothing behind it. */
  function categoriesOnPage() {
    var seen = [];
    document.querySelectorAll("[data-filterable][data-category]").forEach(function (c) {
      var v = c.dataset.category;
      if (v && seen.indexOf(v) === -1) seen.push(v);
    });
    return seen.sort(function (a, b) { return label(a).localeCompare(label(b), "bn"); });
  }

  function init() {
    var panel = document.getElementById("courseFilterPanel");
    var trigger = document.getElementById("courseFilterBtn");
    if (!panel || !trigger || !window.ShahedinFilters) return;
    if (panel.dataset.wired) return;
    if (!document.querySelector("[data-filterable]")) return;   // cards not mounted yet
    panel.dataset.wired = "1";

    var catList = panel.querySelector("[data-fcat-list]");
    var backdrop = document.querySelector(".catalog-backdrop");
    var badge = trigger.querySelector("[data-filter-count]");
    var countEl = panel.querySelector("[data-fcount]");
    var lastFocus = null;

    if (catList) {
      catList.innerHTML = categoriesOnPage().map(function (c) {
        return '<li><label class="fcheck">' +
          '<input type="checkbox" data-fcat="' + esc(c) + '">' +
          '<span class="fcheck-box" aria-hidden="true"></span>' +
          '<span class="fcheck-label">' + esc(label(c)) + "</span>" +
        "</label></li>";
      }).join("");
    }

    function readTypes() {
      var out = [];
      panel.querySelectorAll('[data-ftype]:checked').forEach(function (i) {
        if (i.dataset.ftype !== "all") out.push(i.dataset.ftype);
      });
      return out;
    }
    function readCats() {
      var out = [];
      panel.querySelectorAll("[data-fcat]:checked").forEach(function (i) { out.push(i.dataset.fcat); });
      return out;
    }

    /* "সব কোর্স" behaves as a reset, not as a fourth type: ticking it clears
       the others, and it re-ticks itself whenever nothing else is selected —
       so the group can never end up showing no state at all. */
    function syncAllBox() {
      var all = panel.querySelector('[data-ftype="all"]');
      if (!all) return;
      all.checked = readTypes().length === 0;
    }

    function commit() {
      window.ShahedinFilters.state.courseTypes = readTypes();
      window.ShahedinFilters.state.categories = readCats();
      var visible = window.ShahedinFilters.apply();
      if (countEl) countEl.textContent = bn(visible);
      var active = readTypes().length + readCats().length;
      if (badge) {
        badge.textContent = bn(active);
        badge.hidden = active === 0;
      }
      trigger.classList.toggle("has-filters", active > 0);
    }

    panel.addEventListener("change", function (e) {
      var t = e.target;
      if (t.matches('[data-ftype="all"]')) {
        // ticking "all" clears the rest; untick-ing it on its own is a no-op
        if (t.checked) {
          panel.querySelectorAll("[data-ftype]").forEach(function (i) {
            if (i.dataset.ftype !== "all") i.checked = false;
          });
        } else {
          t.checked = readTypes().length === 0;
        }
      } else if (t.matches("[data-ftype]") || t.matches("[data-fcat]")) {
        syncAllBox();
      } else {
        return;
      }
      commit();
    });

    // The price chips are still driven by main.js's delegated handler; this
    // only keeps the rail's own count in step after one is clicked.
    panel.addEventListener("click", function (e) {
      if (e.target.closest("[data-filter-group] .chip")) setTimeout(commit, 0);
    });

    var clear = panel.querySelector("[data-fclear]");
    if (clear) clear.addEventListener("click", function () {
      panel.querySelectorAll("[data-ftype], [data-fcat]").forEach(function (i) {
        i.checked = i.dataset.ftype === "all";
      });
      var priceGroup = panel.querySelector('[data-filter-group="price"]');
      if (priceGroup) {
        priceGroup.querySelectorAll(".chip").forEach(function (c, i) {
          c.classList.toggle("active", i === 0);
        });
      }
      commit();
    });

    /* ---- mobile drawer behaviour ---- */
    function isStacked() { return window.matchMedia("(max-width: 1080px)").matches; }

    function open() {
      if (!isStacked()) return;
      lastFocus = document.activeElement;
      panel.classList.add("is-open");
      if (backdrop) backdrop.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      var first = panel.querySelector('button, input, [tabindex]:not([tabindex="-1"])');
      if (first) first.focus();
    }
    function close() {
      panel.classList.remove("is-open");
      if (backdrop) backdrop.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    trigger.addEventListener("click", open);
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-fclose]") || e.target.closest("[data-fdone]")) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("is-open")) close();
    });
    // Resizing past the breakpoint must not leave the page scroll-locked.
    window.addEventListener("resize", function () {
      if (!isStacked() && panel.classList.contains("is-open")) close();
    }, { passive: true });

    commit();
  }

  document.addEventListener("contentready", init);
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
