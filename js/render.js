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
    chevron: svg(`<path d="m6 9 6 6 6-6"/>`, 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
    person: svg(`<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>`),
  };

  /* Rating. One labelled group, SVG stars, Bangla numerals.
     Precise fill, not Math.round. Rounding meant 4.6 through 4.9 all rendered
     five solid stars — so five of the six seeded courses looked identical and
     the catalogue became a wall of flat 5/5, while the numeral beside them
     said ৪.৬. A filled row clipped to value/5 over an outline row shows the
     real figure. An unrated course renders "নতুন" rather than inventing one. */
  function stars(rating) {
    const raw = rating === null || rating === undefined || rating === "" ? NaN : Number(rating);
    if (!isFinite(raw) || raw <= 0) {
      return `<span class="stars stars-new">নতুন</span>`;
    }
    const value = Math.max(0, Math.min(5, raw));
    const pct = (value / 5) * 100;
    const shown = value.toFixed(1).replace(/\.0$/, "");
    return `<span class="stars" role="img" aria-label="৫-এর মধ্যে ${bnNum(shown, { group: false })} রেটিং"><span class="stars-track" aria-hidden="true"><span class="stars-base">${
      ICON.starOutline.repeat(5)
    }</span><span class="stars-fill" style="inline-size:${pct.toFixed(2)}%;">${
      ICON.star.repeat(5)
    }</span></span><span class="rating-value" aria-hidden="true">${bnNum(shown, { group: false })}</span></span>`;
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
    video: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 10l5-3v10l-5-3"/></svg>`,
    quiz: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 1.8-2.5 3.5"/><circle cx="12" cy="16.5" r=".6" fill="currentColor" stroke="none"/></svg>`,
    live_class: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>`,
    resource: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>`,
    pdf: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`,
  };

  /* contentBlockHTML — unchanged name and signature, but it now renders the
     MAIN PANE of the course player rather than one row of a stacked list.

     One contract detail moved deliberately: data-block-id is no longer on the
     pane, it is on the sidebar row. js/course-progress.js counts
     [data-block-id] to work out the total for the progress bar, and if both
     the pane and the sidebar carried it every lesson would be counted twice.
     The sidebar is the canonical list of blocks now, so it owns the id, the
     type, the .cb-title and the [data-cb-progress] checkbox that
     paintProgress() looks for. Nothing in course-progress.js changed. */
  function contentBlockHTML(block, index) {
    const title = escapeHtml(block.title || "");
    const head = (icon) => `<div class="cb-head"><span class="cb-icon">${icon}</span><h3 class="cb-title">${bnNum(index + 1, { group: false })}. ${title}</h3></div>`;
    const lockedNotice = () => `
      <div class="content-block-locked">
        <span class="lock-icon">${ICON.lock}</span>
        <p>এই অংশটি দেখতে হলে এই কোর্সে ভর্তি হতে হবে।</p>
        <a href="#course-buy" class="btn btn-primary btn-sm">কোর্সে ভর্তি হোন</a>
      </div>`;

    if (block.locked) {
      const icon = { video: CB_ICON.video, quiz: CB_ICON.quiz, live_class: CB_ICON.live_class, resource: CB_ICON.resource, pdf: CB_ICON.pdf }[block.type] || CB_ICON.video;
      return `<div class="content-block content-block-locked-wrap" data-block-type="${escapeHtml(block.type)}">
        ${head(icon)}
        ${lockedNotice()}
      </div>`;
    }

    if (block.type === "video") {
      const vid = youtubeEmbedId(block.youtube_url);
      return `<div class="content-block content-block-video" data-block-type="video">
        ${head(CB_ICON.video)}
        ${vid
          ? videoFacade({ url: block.youtube_url, title: block.title || "" })
          : `<p class="small-note">ভিডিও লিংক এখনো দেওয়া হয়নি।</p>`}
      </div>`;
    }

    if (block.type === "quiz") {
      const questions = Array.isArray(block.questions) ? block.questions : [];
      /* data-quiz-block-id rather than data-block-id, for the counting reason
         above. wireQuizzes() reads either, so the quiz-checked event still
         carries the same blockId course-progress.js already listens for. */
      return `<div class="content-block content-block-quiz" data-quiz data-quiz-block-id="${escapeHtml(block.id)}" data-block-type="quiz">
        ${head(CB_ICON.quiz)}
        <div class="quiz-questions">
          ${questions
            .map(
              (q, qi) => `
            <div class="quiz-question" data-qi="${qi}" data-correct="${q.correct_index}">
              <p class="quiz-q-text">${bnNum(qi + 1, { group: false })}. ${escapeHtml(q.question)}</p>
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
      return `<div class="content-block content-block-live" data-block-type="live_class">
        ${head(CB_ICON.live_class)}
        <p class="live-datetime">${escapeHtml(formatLiveDateTime(block.date, block.time))}</p>
        ${block.meeting_link ? `<a href="${escapeHtml(block.meeting_link)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">লাইভ ক্লাসে যোগ দিন</a>` : `<p class="small-note">মিটিং লিংক এখনো দেওয়া হয়নি।</p>`}
      </div>`;
    }

    if (block.type === "resource") {
      return `<div class="content-block content-block-resource" data-block-type="resource">
        ${head(CB_ICON.resource)}
        ${block.url ? `<a href="${escapeHtml(block.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">রিসোর্স দেখুন ${ICON.arrow}</a>` : `<p class="small-note">লিংক এখনো দেওয়া হয়নি।</p>`}
      </div>`;
    }

    if (block.type === "pdf") {
      return `<div class="content-block content-block-pdf" data-block-type="pdf">
        ${head(CB_ICON.pdf)}
        ${block.pdf_url
          ? `<div class="pdf-embed"><iframe src="${escapeHtml(block.pdf_url)}" title="${title}" loading="lazy"></iframe></div><a href="${escapeHtml(block.pdf_url)}" target="_blank" rel="noopener" class="text-link" style="margin-top:10px;">নতুন ট্যাবে খুলুন ${ICON.arrow}</a>`
          : `<p class="small-note">PDF এখনো দেওয়া হয়নি।</p>`}
      </div>`;
    }

    return "";
  }

  /* ---------- Course player ----------
     Groups content_blocks by their optional `section` string, preserving the
     order the admin panel saved them in. A block with no section falls into a
     single untitled group, which is also what every existing course does —
     so a course saved before this field existed renders as one flat list and
     nothing had to be migrated.

     NOTE on locked courses: the courses_safe view in schema.sql rebuilds each
     block as {id, type, title, locked} for visitors who haven't enrolled, and
     that projection does not carry `section`. So a non-enrolled visitor sees
     one untitled group rather than the real section names. That is a
     deliberate degrade, not a bug — changing it means editing the view, and
     that is a schema change to ask about first. */
  /* Returns { groups, order } where `order` is the flat DISPLAY sequence.
     Grouping reorders blocks (a section collects its members even when other
     sections sit between them), so the saved array order and the on-screen
     order are different lists. Everything downstream — the sidebar ordinal,
     the pane heading, and prev/next — reads `order`, so all three agree.
     Previously the sidebar counted the regrouped order while the pane counted
     the raw array, and interleaved sections made them disagree. */
  function groupBlocks(blocks) {
    const groups = [];
    const index = {};
    blocks.forEach((b) => {
      const key = (b.section || "").trim();
      if (!(key in index)) {
        index[key] = groups.length;
        groups.push({ title: key, blocks: [] });
      }
      groups[index[key]].blocks.push(b);
    });
    const order = [];
    groups.forEach((g) => g.blocks.forEach((b) => order.push(b)));
    return { groups, order };
  }

  const CB_TYPE_ICON = (type) =>
    ({ video: CB_ICON.video, quiz: CB_ICON.quiz, live_class: CB_ICON.live_class, resource: CB_ICON.resource, pdf: CB_ICON.pdf }[type] || CB_ICON.video);

  /* One sidebar row. This element — not the pane — carries data-block-id,
     data-block-type, .cb-title and [data-cb-progress], because those are
     exactly what paintProgress() in js/course-progress.js looks for. The
     checkbox stays hidden until that file un-hides it for enrolled students,
     which is the same behaviour the old inline list had. */
  function courseLessonHTML(block, n) {
    const locked = !!block.locked;
    const len = block.duration ? durationBn(block.duration) : "";
    /* data-quiz-scored marks a quiz that can actually be completed by taking
       it. A quiz saved with no questions renders no "check answers" button, so
       quiz-checked can never fire for it and its id could never enter
       completed_blocks — while it still counted toward the total, which left
       the course permanently stuck below 100%. paintProgress keys its quiz
       early-return on this attribute, so an unscorable quiz falls through to
       the ordinary checkbox and stays completable by hand. */
    const scorable = block.type === "quiz" && Array.isArray(block.questions) && block.questions.length > 0;
    /* A locked block gets NO progress control at all. paintProgress un-hides
       every [data-cb-progress] it finds without checking `locked`, which meant
       a padlocked row could show a working "mark complete" checkbox. */
    const control = locked
      ? ""
      : `<label class="cb-progress form-check" data-cb-progress hidden>
        <input type="checkbox" class="cb-complete-check" aria-label="${escapeHtml(block.title || "")} — সম্পন্ন হিসেবে চিহ্নিত করুন">
      </label>`;
    return `<div class="cp-lesson${locked ? " is-locked" : ""}" data-block-id="${escapeHtml(block.id)}" data-block-type="${escapeHtml(block.type)}"${scorable ? ' data-quiz-scored="1"' : ""}>
      ${control}
      <button type="button" class="cp-lesson-btn" data-cp-select="${escapeHtml(block.id)}" tabindex="-1">
        <span class="cp-lesson-ic">${locked ? ICON.lock : CB_TYPE_ICON(block.type)}</span>
        <span class="cb-title">${bnNum(n, { group: false })}. ${escapeHtml(block.title || "")}</span>
        ${len ? `<span class="cp-lesson-len">${escapeHtml(len)}</span>` : ""}
      </button>
    </div>`;
  }

  function coursePlayerHTML(c) {
    const blocks = c.contentBlocks;
    const groups = groupBlocks(blocks).groups;
    let n = 0;
    const sections = groups
      .map((g, gi) => {
        const rows = g.blocks.map((b) => courseLessonHTML(b, ++n)).join("");
        const title = g.title || "সব লেসন";
        return `<section class="cp-section" data-cp-section="${gi}">
          <h3 class="cp-section-h">
            <button type="button" class="cp-section-head" aria-expanded="true" data-cp-toggle="${gi}">
              <span class="cp-section-title">${escapeHtml(title)}</span>
              <span class="cp-section-meta"><span data-cp-count>০</span>/${bnNum(g.blocks.length, { group: false })}</span>
              <span class="cp-chev">${ICON.chevron}</span>
            </button>
          </h3>
          <div class="cp-section-body" data-cp-body="${gi}"><div class="cp-section-inner">${rows}</div></div>
        </section>`;
      })
      .join("");

    return `<div class="course-player" data-course-player data-course-slug="${escapeHtml(c.id || "")}">
      <div class="cp-main"><div class="cp-pane" data-cp-pane tabindex="-1"></div></div>
      <aside class="cp-side" aria-label="কোর্স কনটেন্ট">
        <div class="cp-side-head">
          <span class="cp-side-title">কোর্স কনটেন্ট</span>
          <div data-mount="course-progress-summary"></div>
        </div>
        <div class="cp-sections">${sections}</div>
      </aside>
    </div>`;
  }

  function courseCurriculumHTML(c) {
    if (Array.isArray(c.contentBlocks) && c.contentBlocks.length) {
      return coursePlayerHTML(c);
    }
    // Legacy fallback for courses that only have the old modules/lessons list
    if (Array.isArray(c.modules) && c.modules.length) {
      return c.modules
        .map(
          (m, i) => `
        <div class="accordion-item">
          <button type="button" class="accordion-head" aria-expanded="false"><span>মডিউল ${bnNum(i + 1, { group: false })}: ${escapeHtml(m.title)}</span>${ICON.chevron}</button>
          <div class="accordion-body"><div class="accordion-inner">
            ${m.lessons
              .map(
                ([title, len, preview]) => `
              <div class="lesson-row ${preview ? "preview" : ""}">${ICON.play}<span>${escapeHtml(title)}</span>${preview ? '<span class="badge badge-free">প্রিভিউ</span>' : ""}<span class="len">${escapeHtml(durationBn(len))}</span></div>`
              )
              .join("")}
          </div></div>
        </div>`
        )
        .join("");
    }
    return `<p class="small-note">কারিকুলাম শীঘ্রই আসছে।</p>`;
  }

  /* ---------- Video facade bridge (brief 2.4) ----------
     js/video-facade.js owns the poster, the accent play button, the duration
     badge and the locked / coming-soon states, and only creates the real
     iframe on click. This wrapper keeps render.js working even if that file
     fails to load: the fallback is the old inline embed rather than a hole
     where the video should be. */
  function videoFacade(opts) {
    if (window.VideoFacade && typeof window.VideoFacade.html === "function") {
      return window.VideoFacade.html(opts);
    }
    const vid = youtubeEmbedId(opts.url || opts.id);
    if (!vid) return `<p class="small-note">ভিডিও শীঘ্রই যোগ করা হবে।</p>`;
    return `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${vid}" title="${escapeHtml(opts.title || "")}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }

  /* ---------- Course hero preview player ----------
     Shows the first playable curriculum video as a facade. For a paid course
     the visitor isn't enrolled in, the `courses_safe` view strips every video
     URL, so we fall back to the locked state over the course artwork. */
  function coursePreviewHTML(c) {
    const blocks = Array.isArray(c.contentBlocks) ? c.contentBlocks : [];
    const first = blocks.find((b) => b.type === "video" && !b.locked && youtubeEmbedId(b.youtube_url));
    if (first) {
      return videoFacade({
        url: first.youtube_url,
        title: first.title || c.title || "কোর্স প্রিভিউ",
        image: c.image || "",
      });
    }
    return videoFacade({
      state: blocks.length ? "locked" : "soon",
      title: c.title || "",
      image: c.image || "",
      caption: blocks.length
        ? "কোর্সে ভর্তি হলে সম্পূর্ণ কারিকুলামের ভিডিও দেখতে পারবেন।"
        : "কারিকুলামের ভিডিও শীঘ্রই যোগ করা হবে।",
    });
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
        <button type="button" class="accordion-head" aria-expanded="false"><span>${escapeHtml(f.question)}</span>${ICON.chevron}</button>
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
          scoreEl.textContent = `আপনি ${bnNum(questions.length, { group: false })}টির মধ্যে ${bnNum(correct, { group: false })}টি সঠিক উত্তর দিয়েছেন।`;
        }
        document.dispatchEvent(new CustomEvent("quiz-checked", { detail: { blockId: quizEl.dataset.quizBlockId || quizEl.dataset.blockId } }));
      });
    });
  }

  /* ---------- Course player wiring ----------
     Swaps the main pane without a reload, remembers which sections are open
     for the session, and keeps each section's completed count in step with
     the checkboxes. It deliberately does NOT track progress itself: the
     checkboxes are the ones js/course-progress.js finds and wires to
     markComplete(), so this only reads their state to update the counts. */
  function wireCoursePlayer(root, c) {
    const player = root.querySelector("[data-course-player]");
    if (!player) return;
    const pane = player.querySelector("[data-cp-pane]");
    const blocks = Array.isArray(c.contentBlocks) ? c.contentBlocks : [];
    /* `order` is the DISPLAY sequence after grouping, not the saved array
       order. Sidebar ordinals, the pane heading and prev/next all index into
       it, so all three agree even when sections interleave. */
    const order = groupBlocks(blocks).order;
    const byId = {};
    order.forEach((b, i) => { byId[b.id] = { block: b, displayIndex: i }; });
    const storeKey = "cp-open:" + (c.id || "");
    let currentId = null;

    /* The player mounts inside the left column of .course-body-grid, which is
       a 1.35fr / 1fr split — so without this the video pane resolved to ~230px
       while the instructor bio beside it got ~446px. See the layout note in
       css/style.css §18i. */
    const bodyGrid = player.closest(".course-body-grid");
    if (bodyGrid) bodyGrid.classList.add("has-player");

    /* Which lesson opens first: an explicit #lesson-<id> wins, then the first
       block the student hasn't completed, then the first unlocked one. */
    function startingBlockId() {
      const hash = (location.hash || "").replace(/^#lesson-/, "");
      if (hash) {
        try {
          const id = decodeURIComponent(hash);
          if (byId[id]) return id;
        } catch (e) { /* malformed hash — fall through to resume */ }
      }
      const done = window.SHAHEDIN_COMPLETED_BLOCKS;
      if (Array.isArray(done) && done.length) {
        const next = order.find((b) => !b.locked && done.indexOf(b.id) === -1);
        if (next) return next.id;
      }
      return (order.find((b) => !b.locked) || order[0]).id;
    }

    function rowFor(id) {
      const rows = player.querySelectorAll(".cp-lesson");
      for (let i = 0; i < rows.length; i++) if (rows[i].dataset.blockId === id) return rows[i];
      return null;
    }

    function setSection(sec, isOpen) {
      sec.classList.toggle("is-open", isOpen);
      const head = sec.querySelector(".cp-section-head");
      if (head) head.setAttribute("aria-expanded", String(isOpen));
    }

    function persist() {
      try {
        const openIds = [];
        player.querySelectorAll(".cp-section").forEach((s) => {
          if (s.classList.contains("is-open")) openIds.push(s.dataset.cpSection);
        });
        sessionStorage.setItem(storeKey, JSON.stringify(openIds));
      } catch (e) { /* private mode — the accordion just won't remember */ }
    }

    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(storeKey) || "null"); } catch (e) { saved = null; }

    player.querySelectorAll(".cp-section").forEach((sec) => {
      // default open, so a first-time visitor sees the whole curriculum
      setSection(sec, saved ? saved.indexOf(sec.dataset.cpSection) !== -1 : true);
      const head = sec.querySelector(".cp-section-head");
      if (head) head.addEventListener("click", () => {
        setSection(sec, !sec.classList.contains("is-open"));
        persist();
      });
    });

    /* Roving tabindex, the same pattern js/main.js already uses for [data-tabs].
       Without it a 60-lesson course is 60 tab stops before the mentor card. */
    function setRoving(id) {
      player.querySelectorAll(".cp-lesson").forEach((el) => {
        const btn = el.querySelector(".cp-lesson-btn");
        if (!btn) return;
        const current = el.dataset.blockId === id;
        btn.tabIndex = current ? 0 : -1;
        if (current) btn.setAttribute("aria-current", "true");
        else btn.removeAttribute("aria-current");
      });
    }

    function scrollRowIntoView(row) {
      if (!row || typeof row.scrollIntoView !== "function") return;
      // "nearest" keeps the scroll inside .cp-sections instead of yanking the page
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    function select(id, moveFocus) {
      const entry = byId[id];
      if (!entry) return;
      currentId = id;
      pane.innerHTML = contentBlockHTML(entry.block, entry.displayIndex) + paneNavHTML(entry.displayIndex);
      wireQuizzes(pane);
      player.querySelectorAll(".cp-lesson").forEach((el) => {
        el.classList.toggle("is-current", el.dataset.blockId === id);
      });
      setRoving(id);
      const row = rowFor(id);
      if (row) {
        const sec = row.closest(".cp-section");
        if (sec && !sec.classList.contains("is-open")) {
          setSection(sec, true);
          persist();   // otherwise a section the student closed silently re-opens every load
        }
        scrollRowIntoView(row);
      }
      try {
        // Deep link, so a lesson is bookmarkable and shareable. replaceState
        // rather than push, so Back leaves the course instead of walking
        // backwards through every lesson the student clicked.
        history.replaceState(null, "", "#lesson-" + encodeURIComponent(id));
      } catch (e) { /* file:// or a locked-down context — the player still works */ }
      if (moveFocus) {
        // On mobile the sidebar sits BELOW the pane, so preventScroll would
        // leave the viewport exactly where it was and the tap would look inert.
        const stacked = window.matchMedia("(max-width: 1080px)").matches;
        pane.focus({ preventScroll: !stacked });
        if (stacked && typeof pane.scrollIntoView === "function") {
          pane.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      }
    }

    /* Prev / next, so a student never has to go back to the sidebar to advance.
       Built here rather than inside contentBlockHTML so it wraps the pane once
       instead of being repeated in all six block branches. */
    function paneNavHTML(i) {
      const prev = order[i - 1];
      const next = order[i + 1];
      const label = (b) => escapeHtml((b.title || "").slice(0, 42));
      return `<nav class="cp-nav" aria-label="লেসন নেভিগেশন">
        ${prev
          ? `<button type="button" class="cp-nav-btn cp-nav-prev" data-cp-select="${escapeHtml(prev.id)}">
               <span class="cp-nav-dir">পূর্ববর্তী</span><span class="cp-nav-title">${label(prev)}</span></button>`
          : `<span class="cp-nav-btn is-empty" aria-hidden="true"></span>`}
        ${next
          ? `<button type="button" class="cp-nav-btn cp-nav-next" data-cp-select="${escapeHtml(next.id)}">
               <span class="cp-nav-dir">পরবর্তী লেসন</span><span class="cp-nav-title">${label(next)}</span></button>`
          : `<span class="cp-nav-btn is-empty" aria-hidden="true"></span>`}
      </nav>`;
    }

    let userSelected = false;
    player.addEventListener("click", (e) => {
      const btn = e.target.closest ? e.target.closest("[data-cp-select]") : null;
      if (!btn) return;
      userSelected = true;
      select(btn.getAttribute("data-cp-select"), true);
    });

    player.addEventListener("keydown", (e) => {
      if (!e.target.closest || !e.target.closest(".cp-lesson-btn")) return;
      const rows = Array.from(player.querySelectorAll(".cp-lesson"));
      const at = rows.findIndex((r) => r.dataset.blockId === currentId);
      let to = -1;
      if (e.key === "ArrowDown") to = Math.min(rows.length - 1, at + 1);
      else if (e.key === "ArrowUp") to = Math.max(0, at - 1);
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = rows.length - 1;
      else return;
      e.preventDefault();
      const row = rows[to];
      if (!row) return;
      select(row.dataset.blockId, false);
      const btn = row.querySelector(".cp-lesson-btn");
      if (btn) btn.focus();
    });

    function refreshCounts() {
      player.querySelectorAll(".cp-section").forEach((sec) => {
        const rows = sec.querySelectorAll(".cp-lesson");
        let done = 0;
        rows.forEach((r) => {
          const box = r.querySelector(".cb-complete-check");
          // A completed quiz has no checkbox — course-progress.js records it by
          // injecting .cb-done-badge instead. Reading only the checkbox meant a
          // section containing any quiz could never reach its own total.
          const isDone = !!((box && box.checked) || r.querySelector(".cb-done-badge"));
          r.classList.toggle("is-done", isDone);
          if (isDone) done++;
        });
        const out = sec.querySelector("[data-cp-count]");
        if (out) out.textContent = bnNum(done, { group: false });
        const complete = rows.length > 0 && done === rows.length;
        if (complete && !sec.classList.contains("is-complete")) sec.dataset.justDone = "1";
        sec.classList.toggle("is-complete", complete);
      });
    }

    player.addEventListener("change", (e) => {
      if (e.target && e.target.classList.contains("cb-complete-check")) refreshCounts();
    });
    document.addEventListener("course-completion-changed", refreshCounts);
    /* course-progress.js sets checkbox.checked programmatically, which fires no
       change event. The old setTimeout(…, 0) tried to read the state afterwards
       but lost the race against two awaited network round trips in its init(),
       so a returning student saw every section header at ০/N. It now tells us
       when it has actually painted. */
    document.addEventListener("course-progress-painted", () => {
      refreshCounts();
      /* Progress arrives after the first paint (two awaited network calls), so
         the resume target isn't knowable when the player first mounts. If the
         student hasn't picked a lesson and there's no explicit deep link, jump
         to where they left off now that we know. */
      if (!userSelected && !location.hash) {
        const resumeTo = startingBlockId();
        if (resumeTo && resumeTo !== currentId) select(resumeTo, false);
      }
    });

    if (order.length) {
      select(startingBlockId(), false);
    }
    refreshCounts();
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
  /* Course type badge. Only the two special tracks get one — a plain course
     needs no label, and badging everything would make the badge meaningless. */
  const COURSE_TYPE_BN = { career_track: "ক্যারিয়ার ট্র্যাক", foundation: "ফাউন্ডেশন কোর্স" };

  function courseCard(c) {
    const title = escapeHtml(c.title);
    const duration = durationBn(c.duration);
    const type = c.courseType || "course";
    const typeLabel = COURSE_TYPE_BN[type] || "";
    /* content_blocks is the current curriculum shape, but plenty of courses
       still carry the legacy modules/lessons list — including every one in
       js/data.js. Counting only content_blocks meant the lesson figure was 0
       for all of them and the chip silently disappeared, so fall back to
       summing the modules the same way courseCurriculumHTML does. */
    const lessons = Array.isArray(c.contentBlocks) && c.contentBlocks.length
      ? c.contentBlocks.length
      : Array.isArray(c.modules)
        ? c.modules.reduce((sum, m) => sum + (Array.isArray(m.lessons) ? m.lessons.length : 0), 0)
        : 0;
    const students = Number(c.students) || 0;
    /* Same strikethrough markup productCard already uses, so a discounted
       course and a discounted product read identically across the site. */
    const price = c.free
      ? `<span class="price price-free">ফ্রি</span>`
      /* Reference order: current price first, THEN the struck-through original
         after it. productCard puts the old price first — the catalogue card
         follows the layout being matched here rather than that precedent. */
      : `<span class="price">৳${bnNum(Number(c.price))}${c.oldPrice ? ` <span class="old">৳${bnNum(Number(c.oldPrice))}</span>` : ""}</span>`;
    return `
    <a href="course-detail.html?id=${encodeURIComponent(c.id)}" class="card" data-filterable data-price="${c.free ? "free" : "paid"}" data-category="${escapeHtml(c.category)}" data-course-type="${escapeHtml(type)}" data-title="${title}">
      <div class="thumb thumb-tone-${escapeHtml(c.tone)}${c.image ? " has-image" : ""}">
        ${thumbArt(c, c.title)}
        <div class="thumb-overlay"></div>
        <div class="thumb-badges">
          ${typeLabel ? `<span class="badge badge-accent">${escapeHtml(typeLabel)}</span>` : ``}
          ${c.free ? `<span class="badge badge-free">ফ্রি</span>` : ``}
          ${duration ? `<span class="badge badge-dur">${escapeHtml(duration)}</span>` : ``}
        </div>
      </div>
      <div class="card-body">
        <div class="card-meta">${stars(c.rating)}<span>${escapeHtml(categoryLabel(c.category))}</span></div>
        <div class="card-title card-title-clamp">${title}</div>
        <p class="card-desc">${escapeHtml(c.desc)}</p>
        <div class="card-foot">
          ${price}
          <span class="text-link">কোর্স দেখুন ${ICON.arrow}</span>
        </div>
        ${lessons || students ? `<div class="card-stats">
          ${lessons ? `<span><span class="ic">${ICON.play}</span>${bnNum(lessons)} লেসন</span>` : ``}
          ${students ? `<span><span class="ic">${ICON.users}</span>${bnNum(students)} শিক্ষার্থী</span>` : ``}
        </div>` : ``}
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
      if (curriculumEl) { wireQuizzes(curriculumEl); wireCoursePlayer(curriculumEl, c); }
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
      const galleryMain = document.querySelector("[data-mount='gallery-main']");
      if (galleryMain) {
        galleryMain.className = `gallery-main thumb thumb-tone-${p.tone}${p.image ? " has-image" : ""}`;
        galleryMain.innerHTML = p.image
          ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" decoding="async">`
          : `<span class="thumb-icon">${ICON.image}</span>`;
      }
      // A product row carries exactly one image, so the three tone swatches
      // below the gallery had nothing to switch between and no handler —
      // a control that looked live and was not. Hide the strip until the
      // schema supports a real gallery.
      const galleryThumbs = document.querySelector(".gallery-thumbs");
      if (galleryThumbs) galleryThumbs.hidden = true;
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

  /* Re-pull this course and re-mount the parts that depend on enrolment.
     courses_safe is fetched once at load, so immediately after a free
     enrolment the buy card said "ভর্তি হয়েছেন ✓" while the pane still said
     "ভর্তি হতে হবে" and every row kept its padlock. course-progress.js calls
     this on success, then repaints progress itself. */
  async function refreshCourse() {
    if (!document.querySelector("[data-mount='course-curriculum']")) return false;
    try {
      if (window.ShahedinData && typeof window.ShahedinData.reload === "function") {
        await window.ShahedinData.reload();
      }
      const data = D();
      if (!data.courses.length) return false;
      const id = qs("id") || data.courses[0].id;
      const c = data.courses.find((x) => x.id === id) || data.courses[0];
      mount("[data-mount='course-preview']", coursePreviewHTML(c));
      mount("[data-mount='course-curriculum']", courseCurriculumHTML(c));
      const el = document.querySelector("[data-mount='course-curriculum']");
      if (el) { wireQuizzes(el); wireCoursePlayer(el, c); }
      document.dispatchEvent(new Event("contentready"));
      return true;
    } catch (e) {
      return false;   // caller falls back to a reload
    }
  }

  window.ShahedinCourse = { refresh: refreshCourse };
  // categoryLabel is exposed so js/course-filters.js can label the category
  // toggles from the same CATEGORY_BN map the cards use, rather than keeping a
  // second copy of those Bangla names in sync by hand.
  window.ShahedinRender = { courseCard, productCard, videoCard, categoryLabel };
})();
