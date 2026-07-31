/* =========================================================
   render.js — turns js/data.js arrays into HTML.
   Detail pages (course-detail / product-detail / blog-post)
   read an ?id= or ?slug= query param so every "View" button
   across the site links somewhere real.
   ========================================================= */
(function () {
  "use strict";
  const D = () => window.SITE_DATA || { courses: [], products: [], videos: [], blogPosts: [] };

  /* Every icon carries an explicit width/height. A bare <svg viewBox> with
     neither will inflate to the replaced-element default width and scale its
     height to match — which is what blew up the course preview caption.
     css/style.css also has a zero-specificity safety net for this. */
  const svg = (body, attrs) =>
    `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" ${attrs || 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true" focusable="false">${body}</svg>`;

  const ICON = {
    play: svg(`<path d="M8 5v14l11-7z"/>`, 'fill="currentColor"'),
    clock: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>`),
    users: svg(`<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`),
    star: `<svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="m12 2.6 2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.7 6.1 20.8l1.2-6.6L2.5 9.6l6.6-.9z"/></svg>`,
    starOutline: `<svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true" focusable="false" style="opacity:.4"><path d="m12 2.6 2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.7 6.1 20.8l1.2-6.6L2.5 9.6l6.6-.9z"/></svg>`,
    arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`, 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
    book: svg(`<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`),
    check: svg(`<path d="M20 6 9 17l-5-5"/>`, 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
    lock: svg(`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`),
    inbox: svg(`<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z"/>`),
    image: svg(`<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.6-4.6a2 2 0 0 0-2.8 0L3 21"/>`),
    videoOff: svg(`<path d="M10.7 5H19a2 2 0 0 1 2 2v8.3M17 17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 1.3-1.9M2 2l20 20"/>`),
    person: svg(`<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>`),
  };

  /* Rating.
     Was: literal ★/☆ glyphs plus a bare "(4.8)". Screen readers announced
     "star star star star star (4.8)" and the digits rendered Latin on a
     Bangla page. Now: one labelled group, SVG stars, Bangla numerals. */
  function stars(rating) {
    const value = Number(rating) || 0;
    const full = Math.max(0, Math.min(5, Math.round(value)));
    const shown = value.toFixed(1).replace(/\.0$/, "");
    return `<span class="stars" role="img" aria-label="৫-এর মধ্যে ${bnNum(shown, { group: false })} রেটিং">${
      ICON.star.repeat(full)
    }${ICON.starOutline.repeat(5 - full)}<span class="rating-value" aria-hidden="true">${bnNum(shown, { group: false })}</span></span>`;
  }

  function escapeHtml(str) {
    return (str || "").toString().replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  /* ---------- Bangla presentation helpers ----------
     The site is Bangla-only, but course rows carry English-ish values from
     the database (`general`, `6 weeks`, `4.8`). These convert them for
     display only — nothing is written back, and an unrecognised value is
     passed through untouched rather than mangled. */

  const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

  // "4.8" -> "৪.৮"   |   12400 -> "১২,৪০০"
  function bnNum(value, opts) {
    if (value === null || value === undefined || value === "") return "";
    const group = !opts || opts.group !== false;
    if (typeof value === "number" && group) {
      try {
        return value.toLocaleString("bn-BD");
      } catch (e) {
        /* fall through to digit mapping */
      }
    }
    return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[+d]);
  }

  const CATEGORY_BN = {
    politics: "রাজনীতি",
    economy: "অর্থনীতি",
    skills: "দক্ষতা",
    exam: "পরীক্ষা প্রস্তুতি",
    general: "সাধারণ",
    career: "ক্যারিয়ার",
    history: "ইতিহাস",
    digital: "ডিজিটাল",
    physical: "ফিজিক্যাল",
    books: "বই",
    notes: "নোট",
    merch: "মার্চেন্ডাইজ",
  };
  function categoryLabel(slug) {
    if (!slug) return "";
    const key = String(slug).trim().toLowerCase();
    return CATEGORY_BN[key] || slug;
  }

  // "3h 20m" -> "৩ ঘণ্টা ২০ মিনিট"  |  "6 weeks" -> "৬ সপ্তাহ"
  const DURATION_UNITS = [
    [/\b(\d+)\s*(?:h|hr|hrs|hour|hours|ঘণ্টা)\b/gi, "ঘণ্টা"],
    [/\b(\d+)\s*(?:m|min|mins|minute|minutes|মিনিট)\b/gi, "মিনিট"],
    [/\b(\d+)\s*(?:s|sec|secs|second|seconds)\b/gi, "সেকেন্ড"],
    [/\b(\d+)\s*(?:d|day|days|দিন)\b/gi, "দিন"],
    [/\b(\d+)\s*(?:w|wk|wks|week|weeks|সপ্তাহ)\b/gi, "সপ্তাহ"],
    [/\b(\d+)\s*(?:mo|month|months|মাস)\b/gi, "মাস"],
    [/\b(\d+)\s*(?:y|yr|yrs|year|years|বছর)\b/gi, "বছর"],
    [/\b(\d+)\s*(?:lesson|lessons|লেসন)\b/gi, "লেসন"],
  ];
  function durationBn(raw) {
    if (!raw) return "";
    let out = String(raw).trim();
    if (!/\d/.test(out)) return out;
    let matched = false;
    DURATION_UNITS.forEach(([re, unit]) => {
      out = out.replace(re, (_m, n) => {
        matched = true;
        return bnNum(n, { group: false }) + " " + unit;
      });
    });
    // "14:03" style lesson lengths: digits only, keep the colon form.
    if (!matched && /^[\d:.\s]+$/.test(out)) return bnNum(out, { group: false });
    return matched ? out.replace(/\s+/g, " ").trim() : out;
  }

  /* ---------- Shared empty / error state ---------- */
  function emptyStateHTML(opts) {
    const o = opts || {};
    return `<div class="empty-state${o.variant === "error" ? " state-error" : ""}">
      <span class="empty-icon">${o.icon || ICON.inbox}</span>
      <h3>${escapeHtml(o.title || "কিছু পাওয়া যায়নি")}</h3>
      ${o.body ? `<p>${escapeHtml(o.body)}</p>` : ""}
      ${o.ctaHref ? `<a href="${escapeHtml(o.ctaHref)}" class="btn btn-ghost btn-sm">${escapeHtml(o.ctaText || "ফিরে যান")}</a>` : ""}
    </div>`;
  }

  function youtubeEmbedId(url) {
    if (!url) return "";
    const m = (url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,15})/);
    return m ? m[1] : "";
  }

  function formatLiveDateTime(date, time) {
    if (!date) return "";
    try {
      const d = new Date(`${date}T${time || "00:00"}`);
      const dateStr = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const timeStr = time ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
      return timeStr ? `${dateStr} · ${timeStr}` : dateStr;
    } catch (e) {
      return `${date} ${time || ""}`.trim();
    }
  }

  const CB_ICON = {
    video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 10l5-3v10l-5-3"/></svg>`,
    quiz: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 1.8-2.5 3.5"/><circle cx="12" cy="16.5" r=".6" fill="currentColor" stroke="none"/></svg>`,
    live_class: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>`,
    resource: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>`,
    pdf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`,
  };

  function contentBlockHTML(block, index) {
    const title = escapeHtml(block.title || "");
    const head = (icon) => `<div class="cb-head"><span class="cb-icon">${icon}</span><h3 class="cb-title">${index + 1}. ${title}</h3></div>`;
    const progressControl = `<label class="cb-progress form-check" data-cb-progress hidden><input type="checkbox" class="cb-complete-check"> সম্পন্ন হিসেবে চিহ্নিত করুন</label>`;
    const lockedNotice = () => `
      <div class="content-block-locked">
        <span class="lock-icon">${ICON.lock}</span>
        <p>এই অংশটি দেখতে হলে এই কোর্সে ভর্তি হতে হবে।</p>
        <a href="#course-buy" class="btn btn-primary btn-sm">কোর্সে ভর্তি হোন</a>
      </div>`;

    if (block.locked) {
      const icon = { video: CB_ICON.video, quiz: CB_ICON.quiz, live_class: CB_ICON.live_class, resource: CB_ICON.resource, pdf: CB_ICON.pdf }[block.type] || CB_ICON.video;
      return `<div class="content-block content-block-locked-wrap" data-block-id="${escapeHtml(block.id)}" data-block-type="${escapeHtml(block.type)}">
        ${head(icon)}
        ${lockedNotice()}
      </div>`;
    }

    if (block.type === "video") {
      const vid = youtubeEmbedId(block.youtube_url);
      return `<div class="content-block content-block-video" data-block-id="${escapeHtml(block.id)}" data-block-type="video">
        ${head(CB_ICON.video)}
        ${vid
          ? `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${vid}" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`
          : `<p class="small-note">ভিডিও লিংক এখনো দেওয়া হয়নি।</p>`}
        ${progressControl}
      </div>`;
    }

    if (block.type === "quiz") {
      const questions = Array.isArray(block.questions) ? block.questions : [];
      return `<div class="content-block content-block-quiz" data-quiz data-block-id="${escapeHtml(block.id)}" data-block-type="quiz">
        ${head(CB_ICON.quiz)}
        <div class="quiz-questions">
          ${questions
            .map(
              (q, qi) => `
            <div class="quiz-question" data-qi="${qi}" data-correct="${q.correct_index}">
              <p class="quiz-q-text">${qi + 1}. ${escapeHtml(q.question)}</p>
              <div class="quiz-options">
                ${(q.options || [])
                  .map(
                    (opt, oi) => `<label class="quiz-option"><input type="radio" name="quiz-${index}-${qi}" value="${oi}"><span>${escapeHtml(opt)}</span></label>`
                  )
                  .join("")}
              </div>
            </div>`
            )
            .join("")}
        </div>
        ${questions.length ? `<button type="button" class="btn btn-primary btn-sm" data-check-quiz>উত্তর যাচাই করুন</button><div class="quiz-score" hidden></div>` : `<p class="small-note">এখনো কোনো প্রশ্ন যোগ করা হয়নি।</p>`}
      </div>`;
    }

    if (block.type === "live_class") {
      return `<div class="content-block content-block-live" data-block-id="${escapeHtml(block.id)}" data-block-type="live_class">
        ${head(CB_ICON.live_class)}
        <p class="live-datetime">${escapeHtml(formatLiveDateTime(block.date, block.time))}</p>
        ${block.meeting_link ? `<a href="${escapeHtml(block.meeting_link)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">লাইভ ক্লাসে যোগ দিন</a>` : `<p class="small-note">মিটিং লিংক এখনো দেওয়া হয়নি।</p>`}
        ${progressControl}
      </div>`;
    }

    if (block.type === "resource") {
      return `<div class="content-block content-block-resource" data-block-id="${escapeHtml(block.id)}" data-block-type="resource">
        ${head(CB_ICON.resource)}
        ${block.url ? `<a href="${escapeHtml(block.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">রিসোর্স দেখুন ${ICON.arrow}</a>` : `<p class="small-note">লিংক এখনো দেওয়া হয়নি।</p>`}
        ${progressControl}
      </div>`;
    }

    if (block.type === "pdf") {
      return `<div class="content-block content-block-pdf" data-block-id="${escapeHtml(block.id)}" data-block-type="pdf">
        ${head(CB_ICON.pdf)}
        ${block.pdf_url
          ? `<div class="pdf-embed"><iframe src="${escapeHtml(block.pdf_url)}" title="${title}" loading="lazy"></iframe></div><a href="${escapeHtml(block.pdf_url)}" target="_blank" rel="noopener" class="text-link" style="margin-top:10px;">নতুন ট্যাবে খুলুন ${ICON.arrow}</a>`
          : `<p class="small-note">PDF এখনো দেওয়া হয়নি।</p>`}
        ${progressControl}
      </div>`;
    }

    return "";
  }

  function courseCurriculumHTML(c) {
    if (Array.isArray(c.contentBlocks) && c.contentBlocks.length) {
      return `<div data-mount="course-progress-summary"></div><div class="content-blocks">${c.contentBlocks.map(contentBlockHTML).join("")}</div>`;
    }
    // Legacy fallback for courses that only have the old modules/lessons list
    if (Array.isArray(c.modules) && c.modules.length) {
      return c.modules
        .map(
          (m, i) => `
        <div class="accordion-item">
          <div class="accordion-head"><span>মডিউল ${i + 1}: ${m.title}</span>${ICON.arrow.replace("M5 12h14M13 6l6 6-6 6", "m6 9 6 6 6-6")}</div>
          <div class="accordion-body">
            ${m.lessons
              .map(
                ([title, len, preview]) => `
              <div class="lesson-row ${preview ? "preview" : ""}">${ICON.play}<span>${escapeHtml(title)}</span>${preview ? '<span class="badge badge-free">প্রিভিউ</span>' : ""}<span class="len">${escapeHtml(durationBn(len))}</span></div>`
              )
              .join("")}
          </div>
        </div>`
        )
        .join("");
    }
    return `<p class="small-note">কারিকুলাম শীঘ্রই আসছে।</p>`;
  }

  /* ---------- Course hero preview player ----------
     Shows the first playable curriculum video in the course-detail hero's
     right column. For a paid course the visitor isn't enrolled in, the
     `courses_safe` view strips every video URL, so we fall back to the
     course thumbnail with a locked-state note instead. */
  function coursePreviewHTML(c) {
    const blocks = Array.isArray(c.contentBlocks) ? c.contentBlocks : [];
    const first = blocks.find((b) => b.type === "video" && !b.locked && youtubeEmbedId(b.youtube_url));
    if (first) {
      return `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${youtubeEmbedId(first.youtube_url)}" title="${escapeHtml(first.title || c.title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
        <div class="course-preview-cap">${CB_ICON.video} <span>${escapeHtml(first.title || "কোর্স প্রিভিউ")}</span></div>`;
    }
    const poster = c.image
      ? ` class="course-preview-poster has-image" style="background-image:url('${escapeHtml(c.image)}');"`
      : ` class="course-preview-poster"`;
    return `<div${poster}><span class="lock-icon">${blocks.length ? ICON.lock : ICON.videoOff}</span></div>
      <div class="course-preview-cap">${blocks.length ? ICON.lock : ICON.videoOff}<span>${blocks.length ? "কোর্সে ভর্তি হলে সম্পূর্ণ কারিকুলামের ভিডিও দেখতে পারবেন।" : "কারিকুলামের ভিডিও শীঘ্রই যোগ করা হবে।"}</span></div>`;
  }

  const DEFAULT_MENTOR = {
    name: "Shahedin",
    bio: "ইউটিউব ক্রিয়েটর ও রাজনৈতিক বিশ্লেষক, ১৮ লাখ+ সাবস্ক্রাইবার।",
    avatar_url: "assets/img/shahedin-cutout.webp",
  };

  /* ASSET NOTE (mentor avatar): the default falls back to
     shahedin-cutout.webp, which is a full-body footer cutout — inside a 64px
     circle it crops to a forehead. `.mentor-avatar` therefore frames it with
     a wide top-weighted crop and a gradient bed so it reads as a portrait
     medallion rather than a mis-cropped photo. A proper replacement is a
     square head-and-shoulders crop, >=256px, face centred.
     If there is no avatar at all we draw a monogram instead of a hole. */
  function courseMentorHTML(c) {
    const m = c.mentor && c.mentor.name ? c.mentor : DEFAULT_MENTOR;
    const avatarInner = m.avatar_url
      ? `<img src="${escapeHtml(m.avatar_url)}" alt="${escapeHtml(m.name || "প্রশিক্ষক")}" loading="lazy" decoding="async">`
      : `<span class="mentor-monogram">${escapeHtml((m.name || "?").slice(0, 1))}</span>`;
    return `<div class="mentor-card">
      <div class="mentor-avatar">${avatarInner}</div>
      <div class="mentor-body">
        <h3>${escapeHtml(m.name || "")}</h3>
        ${m.bio ? `<p>${escapeHtml(m.bio)}</p>` : ""}
      </div>
    </div>`;
  }

  function courseFaqHTML(c) {
    const faqs = Array.isArray(c.faqs) ? c.faqs : [];
    if (!faqs.length) return `<p class="small-note">এই কোর্সের জন্য এখনো কোনো সাধারণ জিজ্ঞাসা যোগ করা হয়নি।</p>`;
    return faqs
      .map(
        (f) => `
      <div class="accordion-item">
        <div class="accordion-head"><span>${escapeHtml(f.question)}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></div>
        <div class="accordion-body"><p style="padding:14px 22px 20px; margin:0; border-top:1px solid var(--line); font-size:.9rem; color:var(--text-muted);">${escapeHtml(f.answer)}</p></div>
      </div>`
      )
      .join("");
  }

  function wireQuizzes(scopeEl) {
    scopeEl.querySelectorAll("[data-quiz]").forEach((quizEl) => {
      const btn = quizEl.querySelector("[data-check-quiz]");
      if (!btn || btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", () => {
        let correct = 0;
        const questions = quizEl.querySelectorAll(".quiz-question");
        questions.forEach((qEl) => {
          const correctIdx = qEl.dataset.correct;
          const options = qEl.querySelectorAll(".quiz-option");
          const selected = qEl.querySelector("input:checked");
          options.forEach((optEl) => optEl.classList.remove("is-correct", "is-wrong"));
          if (selected) {
            const optLabel = selected.closest(".quiz-option");
            if (selected.value === correctIdx) {
              optLabel.classList.add("is-correct");
              correct++;
            } else {
              optLabel.classList.add("is-wrong");
              const correctLabel = qEl.querySelector(`.quiz-option input[value="${correctIdx}"]`)?.closest(".quiz-option");
              if (correctLabel) correctLabel.classList.add("is-correct");
            }
          } else {
            const correctLabel = qEl.querySelector(`.quiz-option input[value="${correctIdx}"]`)?.closest(".quiz-option");
            if (correctLabel) correctLabel.classList.add("is-correct");
          }
        });
        const scoreEl = quizEl.querySelector(".quiz-score");
        if (scoreEl) {
          scoreEl.hidden = false;
          scoreEl.textContent = `আপনি ${questions.length}টির মধ্যে ${correct}টি সঠিক উত্তর দিয়েছেন।`;
        }
        document.dispatchEvent(new CustomEvent("quiz-checked", { detail: { blockId: quizEl.dataset.blockId } }));
      });
    });
  }

  /* ---------- Shared card artwork ----------
     Real <img> rather than a CSS background so the artwork can carry alt
     text, and a drawn placeholder when a course/product has no image at all
     instead of a bare gradient. */
  function thumbArt(item, alt) {
    if (item.image) {
      return `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(alt || "")}" loading="lazy" decoding="async">`;
    }
    return `<span class="thumb-icon">${ICON.image}</span>`;
  }

  function priceLabel(item) {
    if (item.free || Number(item.price) === 0) return `<span class="price price-free">ফ্রি</span>`;
    return `<span class="price">৳${bnNum(Number(item.price))}</span>`;
  }

  /* ---------- Course card ---------- */
  function courseCard(c) {
    const title = escapeHtml(c.title);
    const duration = durationBn(c.duration);
    return `
    <a href="course-detail.html?id=${encodeURIComponent(c.id)}" class="card" data-filterable data-price="${c.free ? "free" : "paid"}" data-category="${escapeHtml(c.category)}" data-title="${title}">
      <div class="thumb thumb-tone-${escapeHtml(c.tone)}${c.image ? " has-image" : ""}">
        ${thumbArt(c, c.title)}
        <div class="thumb-overlay"></div>
        <div class="thumb-badges">
          ${c.free ? `<span class="badge badge-free">ফ্রি</span>` : ``}
          ${duration ? `<span class="badge badge-dur">${escapeHtml(duration)}</span>` : ``}
        </div>
      </div>
      <div class="card-body">
        <div class="card-meta">${stars(c.rating)}<span>${escapeHtml(categoryLabel(c.category))}</span></div>
        <div class="card-title card-title-clamp">${title}</div>
        <p class="card-desc">${escapeHtml(c.desc)}</p>
        <div class="card-foot">
          ${priceLabel(c)}
          <span class="text-link">কোর্স দেখুন ${ICON.arrow}</span>
        </div>
      </div>
    </a>`;
  }

  /* ---------- Product card ---------- */
  function productCard(p) {
    const title = escapeHtml(p.title);
    return `
    <a href="product-detail.html?id=${encodeURIComponent(p.id)}" class="card" data-filterable data-type="${escapeHtml(p.type)}" data-category="${escapeHtml(p.category)}" data-title="${title}">
      <div class="thumb thumb-tone-${escapeHtml(p.tone)}${p.image ? " has-image" : ""}">
        ${thumbArt(p, p.title)}
        <div class="thumb-overlay"></div>
        <div class="thumb-badges">
          <span class="badge badge-level">${p.type === "digital" ? "ডিজিটাল" : "ফিজিক্যাল"}</span>
          ${p.oldPrice ? `<span class="badge badge-accent" style="margin-inline-start:auto;">সেল</span>` : ""}
        </div>
      </div>
      <div class="card-body">
        <div class="card-title card-title-clamp">${title}</div>
        <p class="card-desc">${escapeHtml(p.desc)}</p>
        <div class="card-foot">
          <span class="price">${p.oldPrice ? `<span class="old">৳${bnNum(Number(p.oldPrice))}</span>` : ""}৳${bnNum(Number(p.price))}</span>
          <span class="text-link">দেখুন ${ICON.arrow}</span>
        </div>
      </div>
    </a>`;
  }

  /* ---------- Video card ---------- */
  function videoCard(v) {
    return `
    <div class="card" data-filterable data-tag="${escapeHtml(v.tag)}" style="min-width:280px;">
      <div class="thumb thumb-tone-${escapeHtml(v.tone)}">
        <div class="thumb-overlay"></div>
        <button class="play-btn" aria-label="ভিডিও চালান">${ICON.play}</button>
        <div class="thumb-badges"><span class="badge badge-dur">${escapeHtml(durationBn(v.duration))}</span></div>
      </div>
      <div class="card-body">
        <div class="card-title card-title-clamp">${escapeHtml(v.title)}</div>
        <div class="card-meta">${bnNum(v.views)} ভিউ</div>
      </div>
    </div>`;
  }
  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  /* ---------- Page mounts ---------- */
  function mount(selector, html) {
    const el = document.querySelector(selector);
    if (el) el.innerHTML = html;
  }

  function runRender() {
    if (window.__shahedinRendered) return; // guard against double-render
    window.__shahedinRendered = true;
    const data = D();

    // A grid whose data source is empty gets a designed state, not a blank
    // rectangle. `span` keeps the state centred across the whole grid.
    function gridOrEmpty(items, cardFn, empty) {
      if (!items.length) {
        return `<div style="grid-column:1/-1;">${emptyStateHTML(empty)}</div>`;
      }
      return items.map(cardFn).join("");
    }

    // Home: featured (videos are now handled by js/youtube-videos.js)
    if (document.querySelector("[data-mount='featured-courses']")) {
      mount(
        "[data-mount='featured-courses']",
        gridOrEmpty(data.courses.slice(0, 3), courseCard, {
          icon: ICON.book,
          title: "কোর্স শীঘ্রই আসছে",
          body: "প্রথম কোর্সগুলো তৈরি হচ্ছে — ইউটিউব চ্যানেলে চোখ রাখুন।",
          ctaHref: "index.html#videos",
          ctaText: "ফ্রি ভিডিও দেখুন",
        })
      );
    }

    // Course catalog
    if (document.querySelector("[data-mount='course-grid']")) {
      mount(
        "[data-mount='course-grid']",
        gridOrEmpty(data.courses, courseCard, {
          icon: ICON.book,
          title: "এখনো কোনো কোর্স প্রকাশ করা হয়নি",
          body: "নতুন কোর্স যুক্ত হলে এখানেই দেখতে পাবেন।",
          ctaHref: "index.html",
          ctaText: "হোমে ফিরে যান",
        })
      );
      window.dispatchEvent(new Event("resize")); // nudge filter re-eval if needed
      document.dispatchEvent(new Event("contentready"));
    }

    // Store
    if (document.querySelector("[data-mount='product-grid']")) {
      mount(
        "[data-mount='product-grid']",
        gridOrEmpty(data.products, productCard, {
          icon: ICON.inbox,
          title: "স্টোর এখন খালি",
          body: "নতুন বই, নোট ও মার্চেন্ডাইজ শীঘ্রই যুক্ত হবে।",
          ctaHref: "courses.html",
          ctaText: "কোর্স দেখুন",
        })
      );
      document.dispatchEvent(new Event("contentready"));
    }

    // Course detail
    const courseMount = document.querySelector("[data-mount='course-detail']");
    if (courseMount) {
      // An empty courses table used to throw here (`data.courses[0].id` on an
      // empty array), which killed every later mount on the page. Bail to a
      // real empty state instead.
      if (!data.courses.length) {
        mount("[data-mount='course-detail']", emptyStateHTML({
          title: "কোর্সটি খুঁজে পাওয়া যায়নি",
          body: "এই কোর্সটি সরিয়ে ফেলা হয়েছে অথবা এখনো প্রকাশ করা হয়নি।",
          ctaHref: "courses.html",
          ctaText: "সব কোর্স দেখুন",
        }));
        const buyEl = document.querySelector("[data-mount='course-buy']");
        if (buyEl) buyEl.remove();
        const previewEl = document.querySelector("[data-mount='course-preview']");
        if (previewEl) previewEl.remove();
        document.dispatchEvent(new Event("contentready"));
        return;
      }
      const id = qs("id") || data.courses[0].id;
      const c = data.courses.find((x) => x.id === id) || data.courses[0];
      document.title = c.title + " — Shahedin";
      window.SHAHEDIN_CURRENT_COURSE = { dbId: c.dbId || null, slug: c.id, title: c.title, free: c.free, price: c.price };
      const durationLabel = durationBn(c.duration);
      mount(
        "[data-mount='course-detail']",
        `<nav class="crumb" aria-label="ব্রেডক্রাম্ব"><a href="index.html">হোম</a><span aria-hidden="true">/</span><a href="courses.html">কোর্স</a><span aria-hidden="true">/</span><span>${escapeHtml(c.title)}</span></nav>
         <span class="eyebrow">${escapeHtml(categoryLabel(c.category))}</span>
         <h1>${escapeHtml(c.title)}</h1>
         <div class="meta-row">
           ${stars(c.rating)}
           <span>${ICON.users} ${bnNum(Number(c.students) || 0)} শিক্ষার্থী</span>
           ${durationLabel ? `<span>${ICON.clock} ${escapeHtml(durationLabel)}</span>` : ""}
         </div>
         ${c.desc ? `<p class="course-desc">${escapeHtml(c.desc)}</p>` : ""}`
      );
      mount("[data-mount='course-preview']", coursePreviewHTML(c));
      mount("[data-mount='course-curriculum']", courseCurriculumHTML(c));
      const curriculumEl = document.querySelector("[data-mount='course-curriculum']");
      if (curriculumEl) wireQuizzes(curriculumEl);
      mount("[data-mount='course-faq']", courseFaqHTML(c));
      mount("[data-mount='course-mentor']", courseMentorHTML(c));
      // Layout note: the price + enrol block lives in the hero's LEFT column
      // with the title and description. `.enrolled-banner` is hidden until
      // course-progress.js adds .is-enrolled to the card (B9).
      const includes = Array.isArray(c.includes) && c.includes.length
        ? c.includes
        : [
            { text: `${durationLabel || c.duration} অন-ডিমান্ড ভিডিও` },
            { text: "ডাউনলোডযোগ্য রিসোর্স ও নোট" },
            { text: "সম্পন্নতার সার্টিফিকেট" },
            { text: "বাংলা সাপোর্ট" },
          ];
      mount(
        "[data-mount='course-buy']",
        `<div class="buy-price-row">
           <span class="price${c.free ? " price-free" : ""}">${c.free ? "ফ্রি" : "৳" + bnNum(Number(c.price) || 0)}</span>
           <span class="small-note">${c.free ? "কোনো পেমেন্ট লাগবে না" : "একবার পেমেন্ট, আজীবন অ্যাক্সেস"}</span>
         </div>
         <div class="enrolled-banner">
           <span class="enrolled-check">${ICON.check}</span>
           <span><b>ভর্তি হয়েছেন</b><span>আজীবন অ্যাক্সেস</span></span>
         </div>
         <button class="btn btn-primary btn-block" data-enroll="${escapeHtml(c.id)}">${c.free ? "ফ্রি-তে ভর্তি হোন" : "এখনই কিনুন"}</button>
         <div class="small-note" data-enroll-status style="margin-top:10px; display:none;"></div>
         <ul>
           ${includes.map((item) => `<li>${ICON.check} <span>${escapeHtml(item.text)}</span></li>`).join("")}
         </ul>
         ${c.free ? "" : `<div class="pay-icons">
           <span class="pay-icon pay-bkash">bKash</span>
         </div>`}`
      );
      // Related — hide the whole section rather than show one empty shelf.
      const related = data.courses.filter((x) => x.id !== c.id).slice(0, 3);
      const relatedMount = document.querySelector("[data-mount='related-courses']");
      if (relatedMount) {
        if (related.length) {
          relatedMount.innerHTML = related.map(courseCard).join("");
        } else {
          const section = relatedMount.closest("section");
          if (section) section.hidden = true;
        }
      }
      document.dispatchEvent(new Event("course-mounted"));
    }

    // Product detail
    const productMount = document.querySelector("[data-mount='product-detail']");
    if (productMount) {
      if (!data.products.length) {
        mount("[data-mount='product-detail']", emptyStateHTML({
          title: "প্রোডাক্টটি খুঁজে পাওয়া যায়নি",
          body: "এই প্রোডাক্টটি সরিয়ে ফেলা হয়েছে অথবা এখনো প্রকাশ করা হয়নি।",
          ctaHref: "store.html",
          ctaText: "স্টোরে ফিরে যান",
        }));
        ["product-buy", "gallery-main"].forEach((key) => {
          const el = document.querySelector(`[data-mount='${key}']`);
          if (el) el.remove();
        });
        const thumbs = document.querySelector(".gallery-thumbs");
        if (thumbs) thumbs.remove();
        document.dispatchEvent(new Event("contentready"));
        return;
      }
      const id = qs("id") || data.products[0].id;
      const p = data.products.find((x) => x.id === id) || data.products[0];
      document.title = p.title + " — Shahedin Store";
      mount("[data-mount='gallery-main']", "");
      const galleryMain = document.querySelector("[data-mount='gallery-main']");
      if (galleryMain) {
        galleryMain.className = `gallery-main thumb thumb-tone-${p.tone}${p.image ? " has-image" : ""}`;
        if (p.image) {
          galleryMain.style.backgroundImage = `url('${p.image}')`;
          galleryMain.style.backgroundSize = "cover";
          galleryMain.style.backgroundPosition = "center";
        }
      }
      mount(
        "[data-mount='product-detail']",
        `<nav class="crumb" aria-label="ব্রেডক্রাম্ব"><a href="index.html">হোম</a><span aria-hidden="true">/</span><a href="store.html">স্টোর</a><span aria-hidden="true">/</span><span>${escapeHtml(p.title)}</span></nav>
         <span class="badge badge-level" style="margin:0 0 12px;display:inline-flex;">${p.type === "digital" ? "ডিজিটাল ডাউনলোড" : "ফিজিক্যাল প্রোডাক্ট"}</span>
         <h1>${escapeHtml(p.title)}</h1>
         <div class="price" style="margin:14px 0;">${p.oldPrice ? `<span class="old">৳${bnNum(Number(p.oldPrice))}</span>` : ""}৳${bnNum(Number(p.price))}</div>
         <p>${escapeHtml(p.desc)}</p>
         ${p.type === "physical" ? '<p class="small-note" style="margin-top:10px;">সারা বাংলাদেশে ৩–৫ কার্যদিবসে ডেলিভারি। ডেলিভারি ট্র্যাকিং সহ।</p>' : '<p class="small-note" style="margin-top:10px;">চেকআউটের পর আপনার ইমেইলে সাথে সাথে ডাউনলোড লিংক পাঠানো হবে।</p>'}`
      );
      const buyMount = document.querySelector("[data-mount='product-buy']");
      if (buyMount) {
        buyMount.innerHTML = `
          <div class="qty-row">
            <span class="small-note" style="font-weight:600;color:var(--text);">পরিমাণ</span>
            <div class="qty-stepper">
              <button type="button" data-qty-decr aria-label="Decrease">−</button>
              <span data-qty-value>1</span>
              <button type="button" data-qty-incr aria-label="Increase">+</button>
            </div>
          </div>
          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <button class="btn btn-primary btn-block" data-buy-product="${p.id}">কিনুন</button>
          </div>
          <div class="pay-icons">
            <span class="pay-icon pay-bkash">bKash</span>
          </div>`;
      }
    }

    document.dispatchEvent(new Event("contentready"));
  }

  // data-loader.js always fires "sitedata-ready" (whether it loaded from
  // Supabase or fell back to the sample data in js/data.js), so render.js
  // waits for that instead of DOMContentLoaded to avoid a flash of sample
  // content followed by a re-render once real data arrives.
  document.addEventListener("sitedata-ready", runRender);
  // Safety net: if data-loader.js is ever missing from a page, still render
  // using whatever window.SITE_DATA already has.
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => runRender(), 1500);
  });

  window.ShahedinRender = { courseCard, productCard, videoCard };
})();
