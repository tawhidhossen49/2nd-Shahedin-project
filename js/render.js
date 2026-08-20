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

  /* Search used to match against the card's visible title only — and since
     titles render in one language, searching in the other found nothing, and
     a word from the description found nothing either. Every card now carries
     a data-search index holding both language variants, the description and
     the category (raw + Bangla label). Bangla digits are folded to Latin so
     "৫" and "5" are the same query; js/main.js folds the typed term the same
     way before comparing. */
  function searchIndex(item) {
    return foldDigits(
      [item.title, item.title_bn, item.title_en, item.desc, item.category, categoryLabel(item.category)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
    );
  }

  function foldDigits(str) {
    return String(str).replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d));
  }

  /* What the buyer is told they will get. This has to track what the product
     is actually configured to deliver: promising an instant download for an
     item with nothing attached is exactly the kind of lie this page used to
     tell (it once promised an emailed link, which nothing in the codebase
     could ever send). deliveryType is public on products_safe; the URL itself
     is not, and is never needed here. */
  function deliveryNoteHTML(p) {
    const note = (text) => `<p class="small-note" style="margin-top:10px;">${text}</p>`;
    if (p.type === "physical") return note("সারা বাংলাদেশে ৩–৫ কার্যদিবসে ডেলিভারি।");
    if (p.deliveryType === "file") return note("কেনার সাথে সাথেই আপনার ড্যাশবোর্ড থেকে ফাইলটি ডাউনলোড করতে পারবেন।");
    if (p.deliveryType === "link") return note("কেনার সাথে সাথেই আপনার ড্যাশবোর্ড থেকে অ্যাক্সেস লিংক পাবেন।");
    return note("অর্ডার সম্পন্ন হলে এটি আপনার ড্যাশবোর্ডের “অর্ডার” তালিকায় যুক্ত হবে, এবং আমরা আপনার সাথে যোগাযোগ করব।");
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

  /* A Shorts URL is the one case where YouTube tells us the shape of the
     video before it loads: /shorts/ is only ever vertical. An iframe is
     cross-origin so its content cannot be measured, and the oEmbed lookup that
     would report real dimensions is a network round trip on first paint --
     neither is worth it when the path segment already says so.

     A Short pasted as youtu.be/<id> is indistinguishable from a normal video
     and falls back to 16:9; the admin hint asks for the /shorts/ form. */
  function isYouTubeShort(url) {
    return String(url || "").toLowerCase().indexOf("youtube.com/shorts/") !== -1;
  }

  /* Case-insensitive: a domain is, and a pasted "WWW.YouTube.com/SHORTS/…"
     used to miss this match entirely and fall through to the uploaded-file
     branch, which put a YouTube page URL inside a <video> tag. The captured
     id keeps its own casing -- the i flag does not fold the capture. */
  function youtubeEmbedId(url) {
    if (!url) return "";
    const m = (url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,15})/i);
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

  const CB_TYPE_LABEL = {
    video: "ভিডিও",
    quiz: "কুইজ",
    live_class: "লাইভ ক্লাস",
    resource: "রিসোর্স",
    pdf: "পিডিএফ",
  };

  /* ---------- Curriculum block BODY ----------
     Just the inner content. The dropdown shell around it is built by
     contentBlockHTML() below, so a block's markup no longer has to repeat
     its own header. */
  function contentBlockBodyHTML(block, index) {
    const title = escapeHtml(block.title || "");
    const progressControl = `<label class="cb-progress form-check" data-cb-progress hidden><input type="checkbox" class="cb-complete-check"> সম্পন্ন হিসেবে চিহ্নিত করুন</label>`;

    if (block.type === "video") {
      const vid = youtubeEmbedId(block.youtube_url);
      /* enablejsapi + origin are what let js/video-progress.js talk to the
         player: without them getCurrentTime() is unavailable and watching a
         video counts for nothing. The watch bar underneath is filled in by
         that file from the student's saved position, so a lesson they are
         halfway through looks halfway through before they press play. */
      return `${vid
          ? `<div class="video-embed" data-yt-video>
               <iframe src="https://www.youtube.com/embed/${vid}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&rel=0"
                       title="${title}" frameborder="0"
                       allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                       allowfullscreen loading="lazy"></iframe>
             </div>
             <div class="watch-bar" data-watch-bar hidden>
               <div class="watch-track"><div class="watch-fill"></div></div>
               <span class="watch-label"></span>
             </div>`
          : `<p class="small-note">ভিডিও লিংক এখনো দেওয়া হয়নি।</p>`}
        ${progressControl}`;
    }

    if (block.type === "quiz") {
      const questions = Array.isArray(block.questions) ? block.questions : [];
      return `<div class="quiz-questions">
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
        ${questions.length ? `<button type="button" class="btn btn-primary btn-sm" data-check-quiz>উত্তর যাচাই করুন</button><div class="quiz-score" hidden></div>` : `<p class="small-note">এখনো কোনো প্রশ্ন যোগ করা হয়নি।</p>`}`;
    }

    if (block.type === "live_class") {
      return `<p class="live-datetime">${escapeHtml(formatLiveDateTime(block.date, block.time))}</p>
        ${block.meeting_link ? `<a href="${escapeHtml(block.meeting_link)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">লাইভ ক্লাসে যোগ দিন</a>` : `<p class="small-note">মিটিং লিংক এখনো দেওয়া হয়নি।</p>`}
        ${progressControl}`;
    }

    if (block.type === "resource") {
      return `${block.url ? `<a href="${escapeHtml(block.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">রিসোর্স দেখুন ${ICON.arrow}</a>` : `<p class="small-note">লিংক এখনো দেওয়া হয়নি।</p>`}
        ${progressControl}`;
    }

    if (block.type === "pdf") {
      return `${block.pdf_url
          ? `<div class="pdf-embed"><iframe src="${escapeHtml(block.pdf_url)}" title="${title}" loading="lazy"></iframe></div><a href="${escapeHtml(block.pdf_url)}" target="_blank" rel="noopener" class="text-link" style="margin-top:10px;">নতুন ট্যাবে খুলুন ${ICON.arrow}</a>`
          : `<p class="small-note">PDF এখনো দেওয়া হয়নি।</p>`}
        ${progressControl}`;
    }

    return `<p class="small-note">এই অংশের কনটেন্ট এখনো যোগ করা হয়নি।</p>`;
  }

  /* ---------- Curriculum block SHELL ----------
     Every block is a dropdown driven by the same .accordion-item / .open
     mechanism as the FAQ (main.js owns the toggle), so the two lists on the
     page behave identically.

     Locked blocks are the important case. On a paid course the visitor has
     not enrolled in, the `courses_safe` view in schema.sql has ALREADY
     stripped the youtube_url / pdf_url / meeting_link / quiz answers before
     they ever reach the browser — the block arrives as
     {id, type, title, locked:true} and there is nothing to reveal. So a
     locked row renders as a head only, with a padlock where the chevron
     would be and aria-disabled set; main.js refuses to open it and points
     the visitor at the buy card instead. The lock is honest UI over a real
     server-side restriction, not a CSS curtain over content that shipped. */
  function contentBlockHTML(block, index) {
    const title = escapeHtml(block.title || "");
    const type = escapeHtml(block.type || "");
    const icon = CB_ICON[block.type] || CB_ICON.video;
    const kind = CB_TYPE_LABEL[block.type] || "";
    const head = `<span class="cb-head-main">
        <span class="cb-icon">${icon}</span>
        <span class="cb-head-text">
          <span class="cb-title">${bnNum(index + 1, { group: false })}. ${title}</span>
          ${kind ? `<span class="cb-kind">${kind}</span>` : ""}
        </span>
      </span>`;

    if (block.locked) {
      // Deliberately NOT aria-disabled: the button does have an action, it
      // just isn't "expand". It explains the lock and moves the visitor to
      // the price card, so marking it disabled would misdescribe it to
      // assistive tech and drop it out of the tab order for no reason.
      // aria-expanded is omitted for the same reason — there is no panel.
      return `<div class="accordion-item cb-acc is-locked" data-no-autoopen data-block-id="${escapeHtml(block.id)}" data-block-type="${type}">
        <button type="button" class="accordion-head cb-acc-head" data-locked-block>
          <span class="visually-hidden">লক করা — </span>
          ${head}
          <span class="cb-lock" aria-hidden="true">${ICON.lock}</span>
        </button>
      </div>`;
    }

    // data-quiz goes on the ROOT, not the panel: wireQuizzes() reads
    // quizEl.dataset.blockId off the same element when it fires
    // "quiz-checked", and only the root carries the block id.
    return `<div class="accordion-item cb-acc" data-no-autoopen${block.type === "quiz" ? " data-quiz" : ""} data-block-id="${escapeHtml(block.id)}" data-block-type="${type}">
      <button type="button" class="accordion-head cb-acc-head" aria-expanded="false">
        ${head}
        ${ICON.chevron}
      </button>
      <div class="accordion-body">
        <div class="cb-body">${contentBlockBodyHTML(block, index)}</div>
      </div>
    </div>`;
  }

  function courseCurriculumHTML(c) {
    if (Array.isArray(c.contentBlocks) && c.contentBlocks.length) {
      // One shared notice under the list instead of a locked panel repeated
      // inside every row — the padlock on each head already says which rows
      // are shut, so the enrol CTA only needs to appear once.
      const anyLocked = c.contentBlocks.some((b) => b.locked);
      const lockedNote = anyLocked
        ? `<div class="curriculum-locked-note">
             <span class="lock-icon">${ICON.lock}</span>
             <div class="cln-copy">
               <b>কনটেন্টগুলো লক করা আছে</b>
               <p>সব ভিডিও, কুইজ ও রিসোর্স দেখতে হলে এই কোর্সে ভর্তি হতে হবে।</p>
             </div>
             <!-- A real trigger, not a jump link. data-enroll-cta is picked up
                  by course-progress.js alongside the price card button and runs
                  the identical enrolment flow, so this no longer just scrolls
                  the visitor to a second button they have to press. A <button>
                  rather than an <a> because it performs an action and because
                  the flow sets .disabled on whatever was clicked. -->
             <button type="button" class="btn btn-primary btn-sm" data-enroll-cta>কোর্সে ভর্তি হোন</button>
           </div>`
        : "";
      return `<div data-mount="course-progress-summary"></div><div class="content-blocks curriculum-accordion">${c.contentBlocks.map(contentBlockHTML).join("")}</div>${lockedNote}`;
    }
    // Legacy fallback for courses that only have the old modules/lessons list
    if (Array.isArray(c.modules) && c.modules.length) {
      return c.modules
        .map(
          (m, i) => `
        <div class="accordion-item">
          <button type="button" class="accordion-head" aria-expanded="false"><span>মডিউল ${bnNum(i + 1, { group: false })}: ${escapeHtml(m.title)}</span>${ICON.chevron}</button>
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
    return `<p class="small-note">কনটেন্ট শীঘ্রই যুক্ত করা হবে।</p>`;
  }

  /* ---------- Course hero backdrop ----------
     The hero used to carry a 16:9 preview player in a second column. The
     thumbnail now runs full bleed behind the whole band instead (see
     .course-hero-media in css/style.css), and the curriculum dropdowns below
     are where videos actually get watched. A course with no thumbnail simply
     keeps the hero's gradient — the layout does not depend on the image
     being there. */
  function courseHeroMedia(c) {
    const el = document.querySelector("[data-mount='course-hero-media']");
    if (!el) return;
    const hero = el.closest(".course-hero");
    if (c.image) {
      el.innerHTML = `<img src="${escapeHtml(c.image)}" alt="" decoding="async" fetchpriority="high">`;
      if (hero) hero.classList.add("has-media");
    } else {
      el.innerHTML = "";
      if (hero) hero.classList.remove("has-media");
    }
  }

  /* ---------- Course preview / trailer ----------
     One admin field holds either a YouTube link or an uploaded video file, so
     the admin never has to declare which kind it is -- the URL says so.

     A YouTube link becomes a lazy iframe; anything else is served through a
     native <video> with controls and no autoplay. Anything that is not an
     http(s) URL renders nothing rather than becoming a live src, so a stray
     "javascript:" typed into the admin field stays inert.

     No poster attribute: pointing it at the course thumbnail would show the
     thumbnail under a play button on a video that hasn't loaded, which reads
     as broken. The browser's own first frame is honest. */
  function coursePreviewHTML(c) {
    const url = String(c.previewVideoUrl || "").trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return "";

    const vid = youtubeEmbedId(url);
    const body = vid
      ? `<iframe src="https://www.youtube.com/embed/${vid}?rel=0"
                 title="কোর্স প্রিভিউ" loading="lazy"
                 allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                 allowfullscreen></iframe>`
      : `<video controls playsinline preload="metadata" src="${escapeHtml(url)}">আপনার ব্রাউজারে ভিডিওটি চালানো যাচ্ছে না।</video>`;

    /* Three shapes, not two.
         is-embed            a normal YouTube video, 16:9
         is-embed is-portrait a Short, 9:16
         is-file             an upload, whatever shape it actually is
       An upload needs no orientation flag: .preview-frame.is-file sizes from
       the file's own intrinsic dimensions, so a phone clip is already tall. */
    const cls = vid ? (isYouTubeShort(url) ? "is-embed is-portrait" : "is-embed") : "is-file";
    return `<div class="preview-frame ${cls}">${body}</div>`;
  }

  const DEFAULT_MENTOR = {
    name: "Shahedin",
    bio: "ইউটিউব ক্রিয়েটর ও রাজনৈতিক বিশ্লেষক, ১৮ লাখ+ সাবস্ক্রাইবার।",
    avatar_url: "assets/img/shahedin-cutout.webp",
  };

  /* ASSET NOTE (mentor portrait): framed 4:5 by .about-portrait and cropped
     from the top, so a head-and-shoulders shot keeps the face. A course with
     no photo draws a monogram rather than leaving a hole in the layout.
     Ideal replacement: portrait orientation, >=800px tall, face in the upper
     third, warm key light. */
  function courseMentorHTML(c) {
    const m = c.mentor && c.mentor.name ? c.mentor : DEFAULT_MENTOR;
    const name = String(m.name || "").trim();
    const role = String(m.bio || "").trim();

    /* One textarea in the admin panel, so paragraph breaks arrive as newlines.
       Split on blank lines first, the way prose is actually written; with none,
       fall back to single newlines so a list typed line-by-line still reads as
       paragraphs instead of one run-on block. */
    const raw = String(m.description || "").replace(/\r\n/g, "\n").trim();
    const chunks = raw
      ? (raw.indexOf("\n\n") !== -1 ? raw.split(/\n{2,}/) : raw.split("\n"))
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    /* role first so it takes .about-copy p:first-of-type -- the larger
       standfirst treatment. With no role the first real paragraph takes it. */
    const paras = [role, ...chunks].filter(Boolean);
    const copy = paras.length
      ? `<div>${paras.map((t) => `<p>${escapeHtml(t)}</p>`).join("")}</div>`
      : "";

    const portrait = m.avatar_url
      ? `<img src="${escapeHtml(m.avatar_url)}" alt="${escapeHtml(name || "প্রশিক্ষক")}" loading="lazy" decoding="async">`
      : `<span class="mentor-monogram">${escapeHtml((name || "?").slice(0, 1))}</span>`;

    /* No .reveal anywhere in here. js/main.js queries .reveal once at load and
       observes what it finds; markup mounted afterwards is never observed, so
       it would sit at opacity:0 permanently -- invisible while still taking
       its full height. The entrance lives on the static section wrapper in
       course-detail.html, which exists in time to be seen. */
    return `<div class="about-grid mentor-feature">
      <div class="about-portrait">${portrait}</div>
      <div class="about-copy">
        ${name ? `<h3 class="mentor-name-lg">${escapeHtml(name)}</h3>` : ""}
        ${copy}
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
    <a href="course-detail.html?id=${encodeURIComponent(c.id)}" class="card" data-filterable data-price="${c.free ? "free" : "paid"}" data-category="${escapeHtml(c.category)}" data-title="${title}" data-search="${escapeHtml(searchIndex(c))}">
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
    <a href="product-detail.html?id=${encodeURIComponent(p.id)}" class="card" data-filterable data-type="${escapeHtml(p.type)}" data-category="${escapeHtml(p.category)}" data-title="${title}" data-search="${escapeHtml(searchIndex(p))}">
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
        const mediaEl = document.querySelector("[data-mount='course-hero-media']");
        if (mediaEl) mediaEl.remove();
        document.dispatchEvent(new Event("contentready"));
        return;
      }
      const id = qs("id") || data.courses[0].id;
      const c = data.courses.find((x) => x.id === id) || data.courses[0];
      document.title = c.title + " — Shahedin";
      window.SHAHEDIN_CURRENT_COURSE = { dbId: c.dbId || null, slug: c.id, title: c.title, free: c.free, price: c.price, purchaseUrl: c.purchaseUrl || null, reviewsEnabled: c.reviewsEnabled !== false };
      const durationLabel = durationBn(c.duration);
      mount(
        "[data-mount='course-detail']",
        `<nav class="crumb" aria-label="ব্রেডক্রাম্ব"><a href="index.html">হোম</a><span aria-hidden="true">/</span><a href="courses.html">কোর্স</a><span aria-hidden="true">/</span><span>${escapeHtml(c.title)}</span></nav>
         <span class="eyebrow">${escapeHtml(categoryLabel(c.category))}</span>
         <h1>${escapeHtml(c.title)}</h1>
         <div class="meta-row">
           ${stars(c.rating)}
           ${c.showStudents === false ? "" : `<span>${ICON.users} ${bnNum(Number(c.students) || 0)} শিক্ষার্থী</span>`}
           ${durationLabel ? `<span>${ICON.clock} ${escapeHtml(durationLabel)}</span>` : ""}
         </div>
         ${c.desc ? `<p class="course-desc">${escapeHtml(c.desc)}</p>` : ""}`
      );
      courseHeroMedia(c);
      /* Both return "" when unconfigured, so the mounts simply stay empty.
         .has-preview is what lets the hero close up to a single full-width
         column when there is no trailer -- without it the copy would sit in a
         1.1fr column next to nine hundred pixels of nothing, which is what the
         price card used to fill. */
      const previewHTML = coursePreviewHTML(c);
      mount("[data-mount='course-preview']", previewHTML);
      const heroGrid = document.querySelector(".course-hero-grid");
      if (heroGrid) heroGrid.classList.toggle("has-preview", !!previewHTML);
      mount("[data-mount='course-curriculum']", courseCurriculumHTML(c));
      const curriculumEl = document.querySelector("[data-mount='course-curriculum']");
      if (curriculumEl) wireQuizzes(curriculumEl);
      mount("[data-mount='course-faq']", courseFaqHTML(c));
      mount("[data-mount='course-mentor']", courseMentorHTML(c));
      /* Layout note: the price + enrol card is no longer in the hero at all.
         It is the first thing in the right-hand rail beside the curriculum,
         directly above "আপনার প্রশিক্ষক" -- see .course-body-grid in
         css/style.css. `.enrolled-banner` is hidden until course-progress.js
         adds .is-enrolled to the card (B9). */
      /* What the course covers. Admin-authored with no default, because an
         empty list has to be reachable: remove every point and the card is not
         rendered at all. Blank rows are dropped here as well as in the panel,
         so a row someone cleared but did not delete cannot render as a tick
         beside nothing. */
      const buyPoints = (Array.isArray(c.learnPoints) ? c.learnPoints : [])
        .map((p) => (typeof p === "string" ? p : (p && p.text) || ""))
        .map((t) => String(t).trim())
        .filter(Boolean);
      /* Two cards, two jobs.

         The price and the button go in the hero under the description, where
         a visitor decides. The checklist goes in the rail beside the
         curriculum, where a visitor compares. Split also means the price card
         no longer changes height with the number of points.

         .buy-price-row and .enrolled-banner stay together in this card on
         purpose: .course-buy-card.is-enrolled hides the first and reveals the
         second, and course-progress.js sets that class by walking up from the
         button with .closest(".course-buy-card"). */
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
         <div class="small-note" data-enroll-status style="margin-top:10px; display:none;"></div>`
      );

      /* "" when the admin has removed every point, so :empty collapses the
         card and the rail starts at the instructor instead of an empty box.

         The heading is optional and rides on the points: a title with no
         points under it would be a card announcing nothing, so an empty list
         drops both. Left blank, the ticks stand on their own exactly as
         before -- adding this cannot change a course that has no title set. */
      const includesTitle = String(c.learnTitle || "").trim();
      mount(
        "[data-mount='course-includes']",
        buyPoints.length
          ? `${includesTitle ? `<h2 class="ic-title">${escapeHtml(includesTitle)}</h2>` : ""}<ul>${buyPoints.map((t) => `<li>${ICON.check} <span>${escapeHtml(t)}</span></li>`).join("")}</ul>`
          : ""
      );
      /* Related — this used to be "the first three other courses", which
         ignored the category entirely and put cooking next to geopolitics.
         Same category first, then anything else only to fill the row out to
         three, so the shelf is never half-empty either. */
      const others = data.courses.filter((x) => x.id !== c.id);
      const sameCategory = others.filter((x) => x.category === c.category);
      const related = sameCategory
        .concat(others.filter((x) => x.category !== c.category))
        .slice(0, 3);
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
         ${deliveryNoteHTML(p)}`
      );
      const buyMount = document.querySelector("[data-mount='product-buy']");
      if (buyMount) {
        /* Stock was carried all the way from the database and then ignored:
           an out-of-stock item could still be ordered, and the +/− stepper had
           no ceiling at all, so 500 of a physical item you hold 2 of went
           through as a completed order. null/undefined still means unlimited
           (every digital good, and any product left blank in the admin). */
        const stock = p.stock === null || p.stock === undefined || p.stock === "" ? null : Number(p.stock);
        const tracked = stock !== null && Number.isFinite(stock);
        const soldOut = tracked && stock <= 0;
        const maxQty = tracked ? Math.max(1, stock) : 0; // 0 = no ceiling

        buyMount.innerHTML = `
          <div class="qty-row">
            <span class="small-note" style="font-weight:600;color:var(--text);">পরিমাণ</span>
            <div class="qty-stepper" data-qty-max="${maxQty}">
              <button type="button" data-qty-decr aria-label="Decrease"${soldOut ? " disabled" : ""}>−</button>
              <span data-qty-value>1</span>
              <button type="button" data-qty-incr aria-label="Increase"${soldOut || maxQty === 1 ? " disabled" : ""}>+</button>
            </div>
          </div>
          ${tracked
            ? `<p class="small-note" style="margin-top:10px;">${
                soldOut
                  ? "এই মুহূর্তে স্টকে নেই।"
                  : `স্টকে আছে ${bnNum(stock)}টি${stock <= 5 ? " — শেষ হয়ে আসছে" : ""}।`
              }</p>`
            : ""}
          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <button class="btn btn-primary btn-block" data-buy-product="${p.id}"${soldOut ? " disabled" : ""}>${soldOut ? "স্টক শেষ" : "কিনুন"}</button>
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
