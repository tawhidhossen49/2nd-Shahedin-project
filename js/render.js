/* =========================================================
   render.js — turns js/data.js arrays into HTML.
   Detail pages (course-detail / product-detail / blog-post)
   read an ?id= or ?slug= query param so every "View" button
   across the site links somewhere real.
   ========================================================= */
(function () {
  "use strict";
  const D = () => window.SITE_DATA || { courses: [], products: [], videos: [], blogPosts: [] };

  const ICON = {
    play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
    users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    star: `★`,
    starOutline: `☆`,
    arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
    book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  };

  function stars(rating) {
    const full = Math.round(rating);
    return ICON.star.repeat(full) + ICON.starOutline.repeat(5 - full) + ` <span style="color:var(--text-faint);font-size:.78rem;">(${rating})</span>`;
  }

  function escapeHtml(str) {
    return (str || "").toString().replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
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
              <div class="lesson-row ${preview ? "preview" : ""}">${ICON.play}<span>${title}</span>${preview ? '<span class="badge badge-free" style="margin:0 8px;">প্রিভিউ</span>' : ""}<span class="len">${len}</span></div>`
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
      ? ` style="background-image:url('${escapeHtml(c.image)}');"`
      : "";
    return `<div class="course-preview-poster"${poster}><span class="lock-icon">${ICON.lock}</span></div>
      <div class="course-preview-cap"><span>${blocks.length ? "কোর্সে ভর্তি হলে সম্পূর্ণ কারিকুলামের ভিডিও দেখতে পারবেন।" : "কারিকুলামের ভিডিও শীঘ্রই যোগ করা হবে।"}</span></div>`;
  }

  const DEFAULT_MENTOR = {
    name: "Shahedin",
    bio: "ইউটিউব ক্রিয়েটর ও রাজনৈতিক বিশ্লেষক, ১৮ লাখ+ সাবস্ক্রাইবার।",
    avatar_url: "assets/img/shahedin-cutout.webp",
  };

  function courseMentorHTML(c) {
    const m = c.mentor && c.mentor.name ? c.mentor : DEFAULT_MENTOR;
    const avatarInner = m.avatar_url
      ? `<img src="${escapeHtml(m.avatar_url)}" alt="${escapeHtml(m.name || "")}" style="width:100%;height:100%;object-fit:cover;object-position:top;">`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;font-family:var(--font-display);">${escapeHtml((m.name || "?").slice(0, 1))}</div>`;
    return `<div class="card" style="padding:26px; flex-direction:row; align-items:center; gap:20px; display:flex;">
      <div style="width:64px;height:64px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--bg-3);">${avatarInner}</div>
      <div>
        <h3 style="font-size:1.05rem;">${escapeHtml(m.name || "")}</h3>
        <p style="font-size:.88rem;">${escapeHtml(m.bio || "")}</p>
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

  /* ---------- Course card ---------- */
  function courseCard(c) {
    return `
    <a href="course-detail.html?id=${c.id}" class="card" data-filterable data-price="${c.free ? "free" : "paid"}" data-category="${c.category}" data-title="${c.title}">
      <div class="thumb thumb-tone-${c.tone}${c.image ? " has-image" : ""}"${c.image ? ` style="background-image:url('${c.image}');background-size:cover;background-position:center;"` : ""}>
        <div class="thumb-overlay"></div>
        <div class="thumb-badges">
          ${c.free ? `<span class="badge badge-free">ফ্রি</span>` : ``}
          <span class="badge badge-dur">${c.duration}</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-meta">${stars(c.rating)}</div>
        <div class="card-title">${c.title}</div>
        <p class="card-desc">${c.desc}</p>
        <div class="card-foot">
          <span class="price">${c.free ? "Free" : "৳" + c.price}</span>
          <span class="text-link">কোর্স দেখুন ${ICON.arrow}</span>
        </div>
      </div>
    </a>`;
  }

  /* ---------- Product card ---------- */
  function productCard(p) {
    return `
    <a href="product-detail.html?id=${p.id}" class="card" data-filterable data-type="${p.type}" data-category="${p.category}" data-title="${p.title}">
      <div class="thumb thumb-tone-${p.tone}${p.image ? " has-image" : ""}"${p.image ? ` style="background-image:url('${p.image}');background-size:cover;background-position:center;"` : ""}>
        <div class="thumb-overlay"></div>
        <div class="thumb-badges">
          <span class="badge badge-level">${p.type === "digital" ? "Digital" : "Physical"}</span>
          ${p.oldPrice ? `<span class="badge" style="background:var(--accent);color:#fff;">সেল</span>` : ""}
        </div>
      </div>
      <div class="card-body">
        <div class="card-title">${p.title}</div>
        <p class="card-desc">${p.desc}</p>
        <div class="card-foot">
          <span class="price">${p.oldPrice ? `<span class="old">৳${p.oldPrice}</span>` : ""}৳${p.price}</span>
          <span class="text-link">View ${ICON.arrow}</span>
        </div>
      </div>
    </a>`;
  }

  /* ---------- Video card ---------- */
  function videoCard(v) {
    return `
    <div class="card" data-filterable data-tag="${v.tag}" style="min-width:280px;">
      <div class="thumb thumb-tone-${v.tone}">
        <div class="thumb-overlay"></div>
        <button class="play-btn" aria-label="Play video">${ICON.play}</button>
        <div class="thumb-badges"><span class="badge badge-dur" style="margin-left:auto;">${v.duration}</span></div>
      </div>
      <div class="card-body">
        <div class="card-title">${v.title}</div>
        <div class="card-meta">${v.views} views</div>
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

    // Home: featured (videos are now handled by js/youtube-videos.js)
    if (document.querySelector("[data-mount='featured-courses']")) {
      mount("[data-mount='featured-courses']", data.courses.slice(0, 3).map(courseCard).join(""));
    }

    // Course catalog
    if (document.querySelector("[data-mount='course-grid']")) {
      mount("[data-mount='course-grid']", data.courses.map(courseCard).join(""));
      window.dispatchEvent(new Event("resize")); // nudge filter re-eval if needed
      document.dispatchEvent(new Event("contentready"));
    }

    // Store
    if (document.querySelector("[data-mount='product-grid']")) {
      mount("[data-mount='product-grid']", data.products.map(productCard).join(""));
      document.dispatchEvent(new Event("contentready"));
    }

    // Course detail
    const courseMount = document.querySelector("[data-mount='course-detail']");
    if (courseMount) {
      const id = qs("id") || data.courses[0].id;
      const c = data.courses.find((x) => x.id === id) || data.courses[0];
      document.title = c.title + " — Shahedin";
      window.SHAHEDIN_CURRENT_COURSE = { dbId: c.dbId || null, slug: c.id, title: c.title, free: c.free, price: c.price };
      mount(
        "[data-mount='course-detail']",
        `<div class="crumb"><a href="index.html">হোম</a> / <a href="courses.html">কোর্স</a> / ${c.title}</div>
         <span class="eyebrow">${c.category}</span>
         <h1>${c.title}</h1>
         <div class="meta-row">
           <span class="stars">${stars(c.rating)}</span>
           <span>${ICON.users} ${c.students.toLocaleString()} শিক্ষার্থী</span>
           <span>${ICON.clock} ${c.duration}</span>
         </div>
         <p style="font-size:1.05rem;">${c.desc}</p>`
      );
      mount("[data-mount='course-preview']", coursePreviewHTML(c));
      mount("[data-mount='course-curriculum']", courseCurriculumHTML(c));
      const curriculumEl = document.querySelector("[data-mount='course-curriculum']");
      if (curriculumEl) wireQuizzes(curriculumEl);
      mount("[data-mount='course-faq']", courseFaqHTML(c));
      mount("[data-mount='course-mentor']", courseMentorHTML(c));
      mount(
        "[data-mount='course-buy']",
        `<div class="price">${c.free ? "ফ্রি" : "৳" + c.price}</div>
         <div class="small-note">${c.free ? "কোনো পেমেন্ট লাগবে না" : "একবার পেমেন্ট, আজীবন অ্যাক্সেস"}</div>
         <button class="btn btn-primary btn-block" style="margin-top:20px;" data-enroll="${c.id}">${c.free ? "ফ্রি-তে ভর্তি হোন" : "এখনই কিনুন"}</button>
         <div class="small-note" data-enroll-status style="margin-top:10px; display:none;"></div>
         <ul>
           ${(Array.isArray(c.includes) && c.includes.length ? c.includes : [{ text: `${c.duration} অন-ডিমান্ড ভিডিও` }, { text: "ডাউনলোডযোগ্য রিসোর্স ও নোট" }, { text: "সম্পন্নতার সার্টিফিকেট" }, { text: "বাংলা সাপোর্ট" }])
             .map((item) => `<li>${ICON.check} ${escapeHtml(item.text)}</li>`)
             .join("")}
         </ul>
         ${c.free ? "" : `<div class="pay-icons">
           <span class="pay-icon pay-bkash">bKash</span>
         </div>`}`
      );
      // Related
      const related = data.courses.filter((x) => x.id !== c.id).slice(0, 3);
      mount("[data-mount='related-courses']", related.map(courseCard).join(""));
      document.dispatchEvent(new Event("course-mounted"));
    }

    // Product detail
    const productMount = document.querySelector("[data-mount='product-detail']");
    if (productMount) {
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
        `<div class="crumb"><a href="index.html">হোম</a> / <a href="store.html">স্টোর</a> / ${p.title}</div>
         <span class="badge badge-level" style="margin:0 0 12px;display:inline-block;">${p.type === "digital" ? "ডিজিটাল ডাউনলোড" : "ফিজিক্যাল প্রোডাক্ট"}</span>
         <h1>${p.title}</h1>
         <div class="price" style="margin:14px 0;">${p.oldPrice ? `<span class="old">৳${p.oldPrice}</span>` : ""}৳${p.price}</div>
         <p>${p.desc}</p>
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
