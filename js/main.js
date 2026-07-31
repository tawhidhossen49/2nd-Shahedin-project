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

  /* ---------- Mobile menu ---------- */
  const burger = document.querySelector(".nav-burger");
  const mobileMenu = document.querySelector(".mobile-menu");
  const mobileClose = document.querySelector(".mobile-menu-close");
  function toggleMenu(open) {
    if (!mobileMenu) return;
    mobileMenu.classList.toggle("open", open);
    document.body.style.overflow = open ? "hidden" : "";
  }
  if (burger) burger.addEventListener("click", () => toggleMenu(true));
  if (mobileClose) mobileClose.addEventListener("click", () => toggleMenu(false));
  document.querySelectorAll(".mobile-menu .nav-link").forEach((l) =>
    l.addEventListener("click", () => toggleMenu(false))
  );

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

  /* ---------- Generic Tabs (.tabs / .tab-btn / .tab-panel) ---------- */
  document.querySelectorAll("[data-tabs]").forEach((group) => {
    const btns = group.querySelectorAll(".tab-btn");
    const panels = document.querySelectorAll(`[data-tab-panel-group="${group.dataset.tabs}"]`);
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        btns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const target = btn.dataset.tabTarget;
        panels.forEach((p) => p.classList.toggle("active", p.dataset.tabPanel === target));
      });
    });
  });

  /* ---------- Accordion (course curriculum) — event delegation so it
     still works on content injected later by render.js ---------- */
  document.addEventListener("click", (e) => {
    const head = e.target.closest(".accordion-head");
    if (!head) return;
    const item = head.closest(".accordion-item");
    const body = item.querySelector(".accordion-body");
    const isOpen = item.classList.contains("open");
    const parent = item.parentElement;
    parent.querySelectorAll(".accordion-item.open").forEach((openItem) => {
      if (openItem !== item) {
        openItem.classList.remove("open");
        openItem.querySelector(".accordion-body").style.maxHeight = null;
      }
    });
    item.classList.toggle("open", !isOpen);
    body.style.maxHeight = !isOpen ? body.scrollHeight + "px" : null;
  });
  function openFirstAccordion() {
    const firstAcc = document.querySelector(".accordion-item");
    if (firstAcc && !document.querySelector(".accordion-item.open")) {
      firstAcc.classList.add("open");
      const b = firstAcc.querySelector(".accordion-body");
      if (b) requestAnimationFrame(() => (b.style.maxHeight = b.scrollHeight + "px"));
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
