/* =========================================================
   main.js — shared site behavior across all pages
   ========================================================= */
(function () {
  "use strict";

  /* ---------- Nav scroll state ----------
     The .scrolled toggle moved into js/motion.js's shared scroll task, so the
     whole site runs on ONE passive scroll listener and one rAF loop
     (brief 2.3). Nothing in this file listens to scroll any more. */

  /* ---------- Mobile menu ----------
     Keyboard-complete: the burger reports its state, Escape closes, focus
     moves into the panel on open and back to the burger on close, and Tab
     is trapped inside the panel while it is open (it covers the page, so
     tabbing to what is underneath would be tabbing into nothing). */
  const burger = document.querySelector(".nav-burger");
  const mobileMenu = document.querySelector(".mobile-menu");
  const mobileClose = document.querySelector(".mobile-menu-close");
  const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function toggleMenu(open) {
    if (!mobileMenu) return;
    mobileMenu.classList.toggle("open", open);
    document.body.style.overflow = open ? "hidden" : "";
    mobileMenu.setAttribute("aria-hidden", open ? "false" : "true");
    if (burger) burger.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      const first = mobileMenu.querySelector(FOCUSABLE);
      if (first) first.focus();
    } else if (burger) {
      burger.focus();
    }
  }

  if (burger) {
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-controls", "mobileMenu");
    burger.addEventListener("click", () => toggleMenu(true));
  }
  if (mobileMenu) {
    mobileMenu.id = mobileMenu.id || "mobileMenu";
    mobileMenu.setAttribute("aria-hidden", "true");
  }
  if (mobileClose) mobileClose.addEventListener("click", () => toggleMenu(false));
  document.querySelectorAll(".mobile-menu .nav-link").forEach((l) =>
    l.addEventListener("click", () => toggleMenu(false))
  );

  document.addEventListener("keydown", (e) => {
    if (!mobileMenu || !mobileMenu.classList.contains("open")) return;
    if (e.key === "Escape") {
      toggleMenu(false);
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(mobileMenu.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /* ---------- Scroll reveal ---------- */
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealEls.length) {
    const ro = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("inview");
            ro.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => ro.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("inview"));
  }

  /* ---------- Growth timeline "in view" dot fill ---------- */
  const growthItems = document.querySelectorAll(".growth-item");
  if ("IntersectionObserver" in window && growthItems.length) {
    const go = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("inview");
        });
      },
      { threshold: 0.4 }
    );
    growthItems.forEach((el) => go.observe(el));
  }

  /* ---------- Generic Tabs (.tabs / .tab-btn / .tab-panel) ----------
     Now a real ARIA tablist: roles and aria-selected are wired up here
     rather than in the markup (so every page that uses [data-tabs] gets it),
     and Left/Right/Home/End move between tabs the way a tablist should. */
  document.querySelectorAll("[data-tabs]").forEach((group) => {
    const btns = Array.from(group.querySelectorAll(".tab-btn"));
    const panels = Array.from(document.querySelectorAll(`[data-tab-panel-group="${group.dataset.tabs}"]`));
    if (!btns.length) return;

    group.setAttribute("role", "tablist");
    btns.forEach((btn, i) => {
      const target = btn.dataset.tabTarget;
      const panel = panels.find((p) => p.dataset.tabPanel === target);
      const tabId = `tab-${group.dataset.tabs}-${target}`;
      const panelId = `panel-${group.dataset.tabs}-${target}`;
      btn.id = tabId;
      btn.setAttribute("role", "tab");
      btn.setAttribute("type", "button");
      if (panel) {
        panel.id = panelId;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tabId);
        btn.setAttribute("aria-controls", panelId);
      }
      const isActive = btn.classList.contains("active");
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.tabIndex = isActive ? 0 : -1;

      function select() {
        btns.forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
          b.tabIndex = -1;
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        btn.tabIndex = 0;
        panels.forEach((p) => p.classList.toggle("active", p.dataset.tabPanel === target));
      }

      btn.addEventListener("click", select);
      btn.addEventListener("keydown", (e) => {
        const keys = { ArrowRight: 1, ArrowLeft: -1 };
        let next = null;
        if (e.key in keys) next = btns[(i + keys[e.key] + btns.length) % btns.length];
        else if (e.key === "Home") next = btns[0];
        else if (e.key === "End") next = btns[btns.length - 1];
        if (!next) return;
        e.preventDefault();
        next.focus();
        next.click();
      });
    });
  });

  /* ---------- Accordion (course curriculum) — event delegation so it
     still works on content injected later by render.js ---------- */
  document.addEventListener("click", (e) => {
    const head = e.target.closest(".accordion-head");
    if (!head) return;
    const item = head.closest(".accordion-item");
    const isOpen = item.classList.contains("open");
    const parent = item.parentElement;
    parent.querySelectorAll(".accordion-item.open").forEach((openItem) => {
      if (openItem !== item) {
        openItem.classList.remove("open");
        const otherHead = openItem.querySelector(".accordion-head");
        if (otherHead) otherHead.setAttribute("aria-expanded", "false");
      }
    });
    /* Height is CSS-driven now (grid-template-rows 0fr -> 1fr), so there is no
       scrollHeight read and no inline max-height to keep in sync. The .open
       class is the single source of truth. */
    item.classList.toggle("open", !isOpen);
    // The heads are <button aria-expanded> — keep the reported state honest.
    head.setAttribute("aria-expanded", String(!isOpen));
  });
  function openFirstAccordion() {
    const firstAcc = document.querySelector(".accordion-item");
    if (firstAcc && !document.querySelector(".accordion-item.open")) {
      firstAcc.classList.add("open");
      const head = firstAcc.querySelector(".accordion-head");
      if (head) head.setAttribute("aria-expanded", "true");
    }
  }
  openFirstAccordion();
  document.addEventListener("contentready", openFirstAccordion);

  /* ---------- Filter chips (courses / store) — delegated ---------- */
  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const group = chip.closest("[data-filter-group]");
    if (!group) return;
    group.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    applyFilters();
  });
  document.addEventListener("input", (e) => {
    if (e.target.matches("[data-search-input]")) applyFilters();
  });
  document.addEventListener("contentready", applyFilters);

  function applyFilters() {
    const cards = document.querySelectorAll("[data-filterable]");
    if (!cards.length) return;
    const activeFilters = {};
    document.querySelectorAll("[data-filter-group]").forEach((group) => {
      const active = group.querySelector(".chip.active");
      activeFilters[group.dataset.filterGroup] = active ? active.dataset.filterValue : "all";
    });
    const searchVal = (document.querySelector("[data-search-input]")?.value || "").trim().toLowerCase();

    cards.forEach((card) => {
      let visible = true;
      Object.entries(activeFilters).forEach(([group, value]) => {
        if (value && value !== "all") {
          const cardVal = card.dataset[group];
          if (cardVal && cardVal !== value) visible = false;
        }
      });
      if (searchVal) {
        const title = (card.dataset.title || card.textContent || "").toLowerCase();
        if (!title.includes(searchVal)) visible = false;
      }
      card.style.display = visible ? "" : "none";
    });

    document.querySelectorAll("[data-empty-state]").forEach((emptyEl) => {
      const anyVisible = Array.from(cards).some((c) => c.style.display !== "none");
      emptyEl.style.display = anyVisible ? "none" : "block";
    });
  }
  applyFilters();

  /* ---------- Toast ---------- */
  function ensureToast() {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    return toast;
  }
  window.showToast = function (msg, ms = 2400) {
    const toast = ensureToast();
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("show"), ms);
  };

  /* ---------- Generic contact / auth-less forms (fake submit) ---------- */
  document.querySelectorAll("[data-fake-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const original = btn ? btn.textContent : null;
      if (btn) {
        btn.textContent = "পাঠানো হচ্ছে...";
        btn.disabled = true;
      }
      setTimeout(() => {
        if (btn) {
          btn.textContent = "পাঠানো হয়েছে ✓";
        }
        window.showToast(form.dataset.fakeForm || "মেসেজ পাঠানো হয়েছে — আমরা শীঘ্রই যোগাযোগ করব।");
        setTimeout(() => {
          if (btn) {
            btn.textContent = original;
            btn.disabled = false;
          }
          form.reset();
        }, 1800);
      }, 700);
    });
  });

  /* ---------- Quantity stepper + buy button (product-detail page) ---------- */
  document.addEventListener("click", (e) => {
    const incr = e.target.closest("[data-qty-incr]");
    const decr = e.target.closest("[data-qty-decr]");
    if (incr || decr) {
      const wrap = (incr || decr).closest(".qty-stepper");
      const valEl = wrap && wrap.querySelector("[data-qty-value]");
      if (!valEl) return;
      let val = parseInt(valEl.textContent, 10) || 1;
      val = incr ? val + 1 : Math.max(1, val - 1);
      valEl.textContent = val;
      return;
    }
    const buyBtn = e.target.closest("[data-buy-product]");
    if (buyBtn) {
      const wrap = document.querySelector(".qty-stepper [data-qty-value]");
      const qty = wrap ? parseInt(wrap.textContent, 10) || 1 : 1;
      window.location.href = `checkout.html?product=${encodeURIComponent(buyBtn.dataset.buyProduct)}&qty=${qty}`;
    }
  });

  /* ---------- Footer subtle parallax ---------- */
  const footerCutout = document.querySelector(".footer-cutout-wrap");
  if (footerCutout && window.matchMedia("(min-width: 761px)").matches) {
    const footer = document.querySelector(".site-footer");
    window.addEventListener(
      "scroll",
      () => {
        if (!footer) return;
        const rect = footer.getBoundingClientRect();
        const winH = window.innerHeight;
        if (rect.top < winH && rect.bottom > 0) {
          const progress = (winH - rect.top) / (winH + rect.height);
          const offset = (progress - 0.5) * 30;
          footerCutout.style.transform = `translateY(${offset}px)`;
        }
      },
      { passive: true }
    );
  }

  /* ---------- Simple calendar widget (contact page) ---------- */
  const calGrid = document.querySelector("[data-cal-grid]");
  if (calGrid) {
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const startDay = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
    calGrid.innerHTML = "";
    for (let i = 0; i < startDay; i++) {
      const empty = document.createElement("div");
      calGrid.appendChild(empty);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement("div");
      cell.className = "cal-day";
      cell.textContent = d;
      const isPast = d < today.getDate();
      const isWeekend = new Date(today.getFullYear(), today.getMonth(), d).getDay() === 5; // Friday off (BD weekend)
      if (isPast || isWeekend) {
        cell.classList.add("disabled");
      } else {
        cell.classList.add("avail");
        cell.addEventListener("click", () => {
          calGrid.querySelectorAll(".cal-day.selected").forEach((c) => c.classList.remove("selected"));
          cell.classList.add("selected");
          window.showToast(`${d} ${today.toLocaleString("bn-BD", { month: "long" })}-এর জন্য স্লট রিকোয়েস্ট করা হয়েছে — আমরা ইমেইলে নিশ্চিত করব।`);
        });
      }
      calGrid.appendChild(cell);
    }
  }

  /* ---------- Set active nav link based on current page ---------- */
  const path = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
    if (link.dataset.page === path) link.classList.add("active");
  });
})();
