/* =========================================================
   main.js — shared site behavior across all pages
   ========================================================= */
(function () {
  "use strict";

  /* ---------- Nav scroll state ---------- */
  const nav = document.querySelector(".site-nav");
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 20);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

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

  /* ---------- Accordion (course curriculum + FAQ) — event delegation so it
     still works on content injected later by render.js ----------

     Two things this has to get right beyond the basic toggle:

     1. LOCKED ROWS. The curriculum renders every block as a dropdown, but a
        block the visitor hasn't paid for arrives from Supabase with its URLs
        already stripped (see the courses_safe view in schema.sql), so there
        is nothing behind it to show. Those heads carry aria-disabled and are
        refused here rather than opening onto an empty panel — clicking one
        sends the visitor to the buy card, which is what they actually want.

     2. CONTENT THAT GROWS AFTER OPENING. max-height has to be a real pixel
        value to animate, but a curriculum panel changes height after the
        fact — a quiz reveals its score, course-progress.js un-hides the
        "mark as complete" checkbox. A frozen scrollHeight would clip both.
        So once the open transition finishes we drop max-height to `none`,
        and put the measured height back for one frame when closing so the
        collapse still animates. */
  function accordionBody(item) {
    return item ? item.querySelector(".accordion-body") : null;
  }

  function openAccordion(item, animate) {
    const body = accordionBody(item);
    const head = item.querySelector(".accordion-head");
    item.classList.add("open");
    if (head) head.setAttribute("aria-expanded", "true");
    if (!body) return;
    body.style.maxHeight = body.scrollHeight + "px";
    const settle = () => {
      if (item.classList.contains("open")) body.style.maxHeight = "none";
    };
    if (animate === false) {
      settle();
      return;
    }
    const onEnd = (ev) => {
      if (ev.target !== body || ev.propertyName !== "max-height") return;
      body.removeEventListener("transitionend", onEnd);
      settle();
    };
    body.addEventListener("transitionend", onEnd);
    // Fallback in case the transition never fires (reduced motion, hidden tab).
    setTimeout(settle, 600);
  }

  function closeAccordion(item) {
    const body = accordionBody(item);
    const head = item.querySelector(".accordion-head");
    if (head) head.setAttribute("aria-expanded", "false");
    if (!body) {
      item.classList.remove("open");
      return;
    }
    if (body.style.maxHeight === "none") {
      body.style.maxHeight = body.scrollHeight + "px";
      void body.offsetHeight; // flush the layout so the next value animates
    }
    item.classList.remove("open");
    requestAnimationFrame(() => {
      if (!item.classList.contains("open")) body.style.maxHeight = null;
    });
  }

  document.addEventListener("click", (e) => {
    const head = e.target.closest(".accordion-head");
    if (!head) return;
    const item = head.closest(".accordion-item");
    if (!item) return;

    // Locked curriculum row: never opens. Say why, then take them to the
    // price card rather than leaving the click with no visible result.
    if (head.hasAttribute("data-locked-block")) {
      e.preventDefault();
      if (window.showToast) window.showToast("এই অংশটি দেখতে হলে এই কোর্সে ভর্তি হতে হবে।");
      const buy = document.getElementById("course-buy");
      if (buy) buy.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const isOpen = item.classList.contains("open");
    const parent = item.parentElement;
    if (parent) {
      parent.querySelectorAll(".accordion-item.open").forEach((openItem) => {
        if (openItem !== item) closeAccordion(openItem);
      });
    }
    if (isOpen) closeAccordion(item);
    else openAccordion(item, true);
  });

  /* The curriculum rows opt out with data-no-autoopen — a course page should
     open with the whole syllabus visible as a list, not with lesson one
     already unrolled (and, on a video block, an iframe already fetched).
     The FAQ keeps its first-answer-open behaviour. */
  function openFirstAccordion() {
    const firstAcc = document.querySelector(
      '.accordion-item:not([data-no-autoopen]):not(.is-locked)'
    );
    if (firstAcc && !document.querySelector(".accordion-item.open")) {
      requestAnimationFrame(() => openAccordion(firstAcc, true));
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

  /* ---------- Demo-only forms (fake submit) ----------
     NOTE: the contact form no longer uses this. It's handled by
     js/contact-form.js, which really does save to Supabase and shows
     up in Admin -> Contact Messages. This stays only for any
     placeholder form that has no backend yet -- do NOT put
     data-fake-form on a form you expect to receive replies from,
     because it shows a success message and discards the input. */
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
  function qtyCeiling(stepper) {
    const max = parseInt(stepper && stepper.dataset.qtyMax, 10);
    return Number.isFinite(max) && max > 0 ? max : Infinity;
  }

  function bnDigits(n) {
    return String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[+d]);
  }

  document.addEventListener("click", (e) => {
    const incr = e.target.closest("[data-qty-incr]");
    const decr = e.target.closest("[data-qty-decr]");
    if (incr || decr) {
      const wrap = (incr || decr).closest(".qty-stepper");
      const valEl = wrap && wrap.querySelector("[data-qty-value]");
      if (!valEl) return;
      // render.js writes data-qty-max from the product's stock. 0/absent means
      // unlimited (digital goods, or stock left blank in the admin panel).
      const ceiling = qtyCeiling(wrap);
      let val = parseInt(valEl.textContent, 10) || 1;
      if (incr && val >= ceiling) {
        window.showToast(`এই প্রোডাক্টের সর্বোচ্চ ${bnDigits(ceiling)}টি নেওয়া যাবে।`);
        return;
      }
      val = incr ? Math.min(ceiling, val + 1) : Math.max(1, val - 1);
      valEl.textContent = val;
      const incrBtn = wrap.querySelector("[data-qty-incr]");
      const decrBtn = wrap.querySelector("[data-qty-decr]");
      if (incrBtn) incrBtn.disabled = val >= ceiling;
      if (decrBtn) decrBtn.disabled = val <= 1;
      return;
    }
    const buyBtn = e.target.closest("[data-buy-product]");
    if (buyBtn) {
      if (buyBtn.disabled) return; // sold out
      const stepper = document.querySelector(".qty-stepper");
      const valEl = stepper && stepper.querySelector("[data-qty-value]");
      // Clamped again here so a hand-edited quantity can't get past the stepper.
      const qty = Math.max(1, Math.min(qtyCeiling(stepper), valEl ? parseInt(valEl.textContent, 10) || 1 : 1));
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
        // The full date, not just the day number: contact-form.js sends this
        // to the admin, and a bare "14" is unreadable a month later.
        const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        cell.dataset.date = iso;
        cell.addEventListener("click", () => {
          calGrid.querySelectorAll(".cal-day.selected").forEach((c) => c.classList.remove("selected"));
          cell.classList.add("selected");
          /* This used to say the slot had been requested and would be
             confirmed by email — but clicking a day sends nothing anywhere.
             The date only reaches anyone if the visitor also submits the form,
             so the message now says that instead of claiming a booking that
             never happened. */
          const label = `${d} ${today.toLocaleString("bn-BD", { month: "long" })}`;
          window.showToast(`${label} বেছে নেওয়া হয়েছে। রিকোয়েস্ট পাঠাতে নিচের ফর্মটি পূরণ করে "পাঠিয়ে দিন" চাপুন।`);
          const form = document.querySelector("[data-contact-form]");
          if (form) {
            form.scrollIntoView({ behavior: "smooth", block: "center" });
            const firstEmpty = Array.from(form.querySelectorAll("input, textarea, select")).find((f) => !f.value);
            if (firstEmpty) firstEmpty.focus({ preventScroll: true });
          }
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
