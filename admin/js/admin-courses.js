(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell("courses.html", "Courses", "Add, edit, unpublish, or remove courses. Changes appear on the live site right away.", admin);
  const content = document.getElementById("adminContent");
  const c = Admin.client();
  let courses = [];
  let editingId = null; // db uuid of course being edited, or null for "new"
  let quizQCounter = 0;

  const CATEGORY_SUGGESTIONS = ["politics", "skills", "economy", "exam", "general"];
  const BLOCK_TYPES = {
    video: "YouTube video",
    quiz: "Mini quiz",
    live_class: "Live class",
    resource: "Resource link",
    pdf: "PDF",
  };

  content.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>All courses</h2>
          <p>Drag isn't needed — use "Order" to control the sequence shown on the site.</p>
        </div>
        <button class="btn btn-primary" id="addCourseBtn">+ Add course</button>
      </div>
      <div id="courseTableWrap"><div class="loading-row"><div class="spinner"></div> Loading courses…</div></div>
    </div>`;

  document.getElementById("addCourseBtn").addEventListener("click", () => openModal(null));

  await loadCourses();
  if (new URLSearchParams(location.search).get("new")) openModal(null);

  async function loadCourses() {
    const { data, error } = await c.from("courses").select("*").order("sort_order", { ascending: true });
    if (error) { Admin.toast("Couldn't load courses: " + error.message, true); return; }
    courses = data || [];
    renderTable();
  }

  function renderTable() {
    const wrap = document.getElementById("courseTableWrap");
    if (!courses.length) {
      wrap.innerHTML = `<div class="empty-state">No courses yet. Click "+ Add course" to create your first one.</div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Course</th><th>Price</th><th>Status</th><th>Reviews</th><th>Order</th><th></th></tr></thead>
        <tbody>
          ${courses.map((course) => `
            <tr>
              <td>
                <div class="row-title-cell">
                  <div class="row-thumb" style="${course.thumbnail_url ? `background-image:url('${course.thumbnail_url}')` : ""}"></div>
                  <div>
                    <div class="row-title">${Admin.escapeHtml(course.title_bn || course.title_en)}</div>
                    <div class="row-sub">${Admin.escapeHtml(course.category)} · /${Admin.escapeHtml(course.slug)}</div>
                  </div>
                </div>
              </td>
              <td>${course.is_free ? '<span class="badge badge-free">Free</span>' : "৳" + course.price_bdt}</td>
              <td>${course.is_published ? '<span class="badge badge-live">Live</span>' : '<span class="badge badge-draft">Draft</span>'}</td>
              <td>
                <button type="button" class="badge badge-toggle reviews-btn ${course.reviews_enabled === false ? "is-off" : "is-on"}"
                        data-id="${course.id}"
                        title="${course.reviews_enabled === false ? "Reviews are hidden on this course page — click to show them" : "Reviews are shown on this course page — click to hide them"}">
                  ${course.reviews_enabled === false ? "Hidden" : "Shown"}
                </button>
              </td>
              <td>${course.sort_order}</td>
              <td>
                <div class="row-actions">
                  <button class="icon-btn edit-btn" data-id="${course.id}" title="Edit"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
                  <button class="icon-btn del-btn" data-id="${course.id}" title="Delete"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg></button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`;

    wrap.querySelectorAll(".edit-btn").forEach((b) => b.addEventListener("click", () => openModal(b.dataset.id)));
    wrap.querySelectorAll(".del-btn").forEach((b) => b.addEventListener("click", () => deleteCourse(b.dataset.id)));
    wrap.querySelectorAll(".reviews-btn").forEach((b) => b.addEventListener("click", () => toggleReviews(b)));
  }

  /* Flips the reviews section on or off for one course, straight from the
     table. The same switch lives in the edit modal, but hiding a course's
     reviews is a one-second decision and shouldn't cost a modal, fourteen
     fields and a full save.

     Only reviews_enabled is sent, so this can't overwrite anything else on the
     row, and the button repaints from the value the database actually stored
     rather than from what was clicked. */
  async function toggleReviews(btn) {
    const id = btn.dataset.id;
    const course = courses.find((x) => x.id === id);
    if (!course) return;
    const next = course.reviews_enabled === false;

    btn.disabled = true;
    const { data, error } = await c
      .from("courses")
      .update({ reviews_enabled: next })
      .eq("id", id)
      .select("reviews_enabled")
      .single();
    btn.disabled = false;

    if (error) {
      if (error.code === "42703" || error.code === "PGRST204") {
        Admin.toast("This database is missing the reviews_enabled column. Run section 23 of schema.sql in the Supabase SQL editor.", true);
      } else {
        Admin.toast("Couldn't change that: " + error.message, true);
      }
      return;
    }

    course.reviews_enabled = data.reviews_enabled;
    renderTable();
    Admin.toast(course.reviews_enabled
      ? "Reviews are now shown on that course page."
      : "Reviews are now hidden on that course page.");
  }

  async function deleteCourse(id) {
    const course = courses.find((x) => x.id === id);
    if (!confirm(`Delete "${course.title_bn || course.title_en}"? This can't be undone.`)) return;
    const { error } = await c.from("courses").delete().eq("id", id);
    if (error) { Admin.toast("Couldn't delete: " + error.message, true); return; }
    Admin.toast("Course deleted.");
    await loadCourses();
  }

  function openModal(id) {
    editingId = id;
    const course = id ? courses.find((x) => x.id === id) : null;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "courseModal";
    backdrop.innerHTML = `
      <div class="modal" style="max-width:760px;">
        <div class="modal-head">
          <h2>${course ? "Edit course" : "Add a new course"}</h2>
          <button class="modal-close" id="closeModal">&times;</button>
        </div>
        <!-- novalidate so the browser's generic bubble can't preempt the
             specific per-field messages; all checks run in saveCourse. -->
        <form id="courseForm" novalidate>
          <div class="form-grid">
            <div class="form-field">
              <label>Title (Bangla) <span class="req">mandatory</span> <span class="hint">· shown on the site</span></label>
              <input type="text" id="f_title_bn" value="${Admin.escapeHtml(course?.title_bn || "")}">
            </div>
            <div class="form-field">
              <label>Title (English) <span class="req">mandatory</span></label>
              <input type="text" id="f_title_en" value="${Admin.escapeHtml(course?.title_en || "")}">
            </div>
            <div class="form-field full">
              <label>Link on the site <span class="req">mandatory</span> <span class="hint">· auto-filled from the title — only change this if you know what it does</span></label>
              <input type="text" id="f_slug" value="${Admin.escapeHtml(course?.slug || "")}">
            </div>
            <div class="form-field full">
              <label>Description (English)</label>
              <textarea id="f_desc_en">${Admin.escapeHtml(course?.description_en || "")}</textarea>
            </div>
            <div class="form-field">
              <label>Category</label>
              <input type="text" id="f_category" list="categoryList" value="${Admin.escapeHtml(course?.category || "general")}">
              <datalist id="categoryList">${CATEGORY_SUGGESTIONS.map((x) => `<option value="${x}">`).join("")}</datalist>
            </div>
            <div class="form-field">
              <label>Duration <span class="hint">shown as a badge, e.g. "3h 20m"</span></label>
              <input type="text" id="f_duration" value="${Admin.escapeHtml(course?.duration_en || "")}">
            </div>
            <div class="form-field">
              <label>Price (৳ BDT)</label>
              <input type="number" id="f_price" min="0" value="${course?.price_bdt ?? 0}">
            </div>
            <div class="form-field">
              <label>&nbsp;</label>
              <label class="form-check"><input type="checkbox" id="f_free" ${course?.is_free ? "checked" : ""}> This course is free</label>
            </div>
            <div class="form-field full">
              <label>Purchase / enrollment form URL
                <span class="hint">where the "এখনই কিনুন" button sends students for this paid course</span>
              </label>
              <input type="url" id="f_purchase_url" placeholder="https://docs.google.com/forms/..."
                     value="${Admin.escapeHtml(course?.purchase_url || "")}">
              <p class="hint" style="margin-top:8px;">
                Only fill this in if <em>this</em> course needs its own form. Leave it blank and the course uses the
                site-wide link from <strong>Settings → Course enrollment</strong>, which is the usual setup.
                Either way: the student logs in, lands on the form, sends the money, and you switch their access on
                from <strong>Students → a student → কোর্স অ্যাক্সেস</strong> once you have verified the payment.
              </p>
            </div>
            <div class="form-field">
              <label>Rating <span class="hint">0–5</span></label>
              <input type="number" id="f_rating" min="0" max="5" step="0.1" value="${course?.rating ?? 4.8}">
            </div>
            <div class="form-field">
              <label>Students enrolled</label>
              <input type="text" value="${course ? (course.students_count ?? 0).toLocaleString() : "0"}" readonly style="cursor:default; opacity:.7;">
              <span class="hint">auto-calculated from real enrollments — updates itself, nothing to type here</span>
            </div>
            <div class="form-field full">
              <label>Thumbnail color</label>
              <div class="tone-picker" id="tonePicker">
                ${[1,2,3,4,5,6].map((t) => `<button type="button" class="tone-${t} ${(course?.tone || 1) === t ? "selected" : ""}" data-tone="${t}"></button>`).join("")}
              </div>
            </div>
            <div class="form-field full">
              <label>Thumbnail image <span class="hint">optional — replaces the color above</span></label>
              <input type="file" id="f_image" accept="image/*">
              ${course?.thumbnail_url ? `<div class="hint">Current: <a href="${course.thumbnail_url}" target="_blank">view image</a></div>` : ""}
            </div>
            <div class="form-field">
              <label>Order on the site</label>
              <input type="number" id="f_sort" value="${course?.sort_order ?? 0}">
            </div>
            <div class="form-field">
              <label>&nbsp;</label>
              <label class="form-check"><input type="checkbox" id="f_published" ${course === null || course?.is_published ? "checked" : ""}> Published (visible on site)</label>
            </div>
            <div class="form-field full">
              <!-- ?? not ||: an unticked box saves false, and false || true is
                   true — which would tick itself back on every time the modal
                   reopened. A brand new course starts with reviews on. -->
              <label class="form-check"><input type="checkbox" id="f_reviews" ${(course ? course.reviews_enabled ?? true : true) ? "checked" : ""}> Show the reviews section on this course page</label>
              <span class="hint">Untick to hide the review list <em>and</em> the write-a-review form for this course only. Existing reviews are kept — they come straight back if you tick it again.</span>
            </div>
          </div>

          <div class="form-field full">
            <label>Course content <span class="hint">what students see on the course page, in this order — add, edit, reorder, or remove anytime</span></label>
            <div id="contentBlockList"></div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
              <button type="button" class="btn btn-ghost btn-sm" data-add-block="video">+ Video</button>
              <button type="button" class="btn btn-ghost btn-sm" data-add-block="quiz">+ Quiz</button>
              <button type="button" class="btn btn-ghost btn-sm" data-add-block="live_class">+ Live class</button>
              <button type="button" class="btn btn-ghost btn-sm" data-add-block="resource">+ Resource link</button>
              <button type="button" class="btn btn-ghost btn-sm" data-add-block="pdf">+ PDF</button>
            </div>
          </div>

          <div class="form-field full">
            <label>Mentor <span class="hint">shown as "Your instructor" on the course page — set any name you like per course</span></label>
            <div class="form-grid" style="margin-top:8px;">
              <div class="form-field">
                <label>Name</label>
                <input type="text" id="f_mentor_name" value="${Admin.escapeHtml(course?.mentor?.name || "")}" placeholder="Shahedin">
              </div>
              <div class="form-field">
                <label>Bio</label>
                <input type="text" id="f_mentor_bio" value="${Admin.escapeHtml(course?.mentor?.bio || "")}" placeholder="ইউটিউব ক্রিয়েটর ও রাজনৈতিক বিশ্লেষক">
              </div>
            </div>
            <input type="file" id="f_mentor_avatar" accept="image/*" style="margin-top:6px;">
            ${course?.mentor?.avatar_url ? `<div class="hint">Current: <a href="${course.mentor.avatar_url}" target="_blank">view image</a></div>` : `<div class="hint">Leave blank to use the default Shahedin photo</div>`}
          </div>

          <div class="form-field full">
            <label>What's included <span class="hint">the checklist shown on the buy card, e.g. "4 weeks on-demand video" — add as many lines as you like</span></label>
            <div id="includesList" class="list-editor" style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;"></div>
            <button type="button" class="btn btn-ghost btn-sm" id="addIncludeBtn">+ Add line</button>
          </div>

          <div class="form-field full">
            <label>FAQ <span class="hint">shown on the course page — add, edit, or remove as many questions as you like</span></label>
            <div id="faqList" class="list-editor" style="display:flex; flex-direction:column; gap:10px; margin-bottom:10px;"></div>
            <button type="button" class="btn btn-ghost btn-sm" id="addFaqBtn">+ Add question</button>
          </div>

          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" id="cancelModal">Cancel</button>
            <button type="submit" class="btn btn-primary" id="saveCourseBtn">${course ? "Save changes" : "Create course"}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    document.getElementById("closeModal").addEventListener("click", closeModal);
    document.getElementById("cancelModal").addEventListener("click", closeModal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });

    // Auto-slug from whichever title is filled in, only while creating.
    // Prefers English for a cleaner URL, falls back to the Bangla title.
    function autoSlug() {
      if (course) return;
      document.getElementById("f_slug").value = Admin.slugifyOrFallback(
        "course",
        document.getElementById("f_title_en").value,
        document.getElementById("f_title_bn").value
      );
    }
    document.getElementById("f_title_en").addEventListener("input", autoSlug);
    document.getElementById("f_title_bn").addEventListener("input", autoSlug);

    document.getElementById("tonePicker").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      backdrop.querySelectorAll(".tone-picker button").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });

    backdrop.querySelectorAll("[data-add-block]").forEach((btn) => {
      btn.addEventListener("click", () => addContentBlock(btn.dataset.addBlock));
    });

    (course?.content_blocks || []).forEach((b) => addContentBlock(b.type, b));

    (course?.includes || []).forEach((item) => addIncludeItem(item));
    if (!course) addIncludeItem(); // start a new course with one empty line to fill in
    document.getElementById("addIncludeBtn").addEventListener("click", () => addIncludeItem());

    (course?.faqs || []).forEach((item) => addFaqItem(item));
    document.getElementById("addFaqBtn").addEventListener("click", () => addFaqItem());

    document.getElementById("courseForm").addEventListener("submit", saveCourse);
  }

  /* ---------- "What's included" checklist editor ---------- */

  function addIncludeItem(existing) {
    const wrap = document.getElementById("includesList");
    const row = document.createElement("div");
    row.style.cssText = "display:flex; gap:8px; align-items:center;";
    row.innerHTML = `
      <input type="text" class="include-text" placeholder="e.g. 4 weeks on-demand video" value="${Admin.escapeHtml(existing?.text || "")}" style="flex:1; background:var(--bg-3); border:1px solid var(--line-strong); border-radius:6px; padding:8px 10px; color:var(--text);">
      <button type="button" class="icon-btn remove-include" title="Remove">✕</button>`;
    wrap.appendChild(row);
    row.querySelector(".remove-include").addEventListener("click", () => row.remove());
  }

  function collectIncludes() {
    return Array.from(document.querySelectorAll("#includesList > div"))
      .map((row) => row.querySelector(".include-text").value.trim())
      .filter((text) => text)
      .map((text) => ({ text }));
  }

  /* ---------- FAQ editor ---------- */

  function addFaqItem(existing) {
    const wrap = document.getElementById("faqList");
    const row = document.createElement("div");
    row.className = "module-block";
    row.innerHTML = `
      <div class="module-head" style="align-items:flex-start;">
        <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
          <input type="text" class="faq-question" placeholder="Question" value="${Admin.escapeHtml(existing?.question || "")}" style="background:var(--bg-3); border:1px solid var(--line-strong); border-radius:6px; padding:8px 10px; color:var(--text);">
          <textarea class="faq-answer" placeholder="Answer" style="background:var(--bg-3); border:1px solid var(--line-strong); border-radius:6px; padding:8px 10px; color:var(--text); min-height:60px;">${Admin.escapeHtml(existing?.answer || "")}</textarea>
        </div>
        <button type="button" class="icon-btn remove-faq" title="Remove">✕</button>
      </div>`;
    wrap.appendChild(row);
    row.querySelector(".remove-faq").addEventListener("click", () => row.remove());
  }

  function collectFaqs() {
    return Array.from(document.querySelectorAll("#faqList > .module-block"))
      .map((row) => ({
        question: row.querySelector(".faq-question").value.trim(),
        answer: row.querySelector(".faq-answer").value.trim(),
      }))
      .filter((f) => f.question || f.answer);
  }

  /* ---------- Content block editor ---------- */

  function blockFieldsHTML(type, existing) {
    if (type === "video") {
      return `
        <div class="form-field full" style="margin-bottom:0;">
          <label>YouTube URL</label>
          <input type="url" class="cb-field" data-field="youtube_url" placeholder="https://www.youtube.com/watch?v=..." value="${Admin.escapeHtml(existing?.youtube_url || "")}">
        </div>`;
    }
    if (type === "live_class") {
      return `
        <div class="form-grid" style="margin-bottom:0;">
          <div class="form-field"><label>Date</label><input type="date" class="cb-field" data-field="date" value="${Admin.escapeHtml(existing?.date || "")}"></div>
          <div class="form-field"><label>Time</label><input type="time" class="cb-field" data-field="time" value="${Admin.escapeHtml(existing?.time || "")}"></div>
          <div class="form-field full"><label>Meeting link</label><input type="url" class="cb-field" data-field="meeting_link" placeholder="https://meet.google.com/..." value="${Admin.escapeHtml(existing?.meeting_link || "")}"></div>
        </div>`;
    }
    if (type === "resource") {
      return `
        <div class="form-field full" style="margin-bottom:0;">
          <label>Link</label>
          <input type="url" class="cb-field" data-field="url" placeholder="https://..." value="${Admin.escapeHtml(existing?.url || "")}">
        </div>`;
    }
    if (type === "pdf") {
      return `
        <div class="form-field full" style="margin-bottom:0;">
          <label>PDF link <span class="hint">a direct public link — e.g. a Google Drive "anyone with the link" share link, or a link to a PDF you've uploaded elsewhere</span></label>
          <input type="url" class="cb-field" data-field="pdf_url" placeholder="https://..." value="${Admin.escapeHtml(existing?.pdf_url || "")}">
        </div>`;
    }
    return ""; // quiz body is built separately
  }

  function addContentBlock(type, existing) {
    const el = document.createElement("div");
    el.className = "module-block";
    el.dataset.type = type;
    el.dataset.blockId = existing?.id || ("cb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    el.innerHTML = `
      <div class="module-head">
        <span class="badge badge-level" style="margin:0;">${BLOCK_TYPES[type] || type}</span>
        <input type="text" placeholder="Title shown to students" class="cb-title" value="${Admin.escapeHtml(existing?.title || "")}" style="flex:1; background:var(--bg-3); border:1px solid var(--line-strong); border-radius:6px; padding:8px 10px; color:var(--text);">
        <button type="button" class="icon-btn move-up" title="Move up">↑</button>
        <button type="button" class="icon-btn move-down" title="Move down">↓</button>
        <button type="button" class="icon-btn remove-block" title="Remove">✕</button>
      </div>
      <div class="cb-body">${blockFieldsHTML(type, existing)}</div>`;
    document.getElementById("contentBlockList").appendChild(el);

    el.querySelector(".remove-block").addEventListener("click", () => el.remove());
    el.querySelector(".move-up").addEventListener("click", () => {
      const prev = el.previousElementSibling;
      if (prev) el.parentNode.insertBefore(el, prev);
    });
    el.querySelector(".move-down").addEventListener("click", () => {
      const next = el.nextElementSibling;
      if (next) el.parentNode.insertBefore(next, el);
    });

    if (type === "quiz") {
      const qList = document.createElement("div");
      qList.className = "quiz-editor-list";
      const addQBtn = document.createElement("button");
      addQBtn.type = "button";
      addQBtn.className = "btn btn-ghost btn-sm";
      addQBtn.textContent = "+ Add question";
      addQBtn.style.marginTop = "8px";
      addQBtn.addEventListener("click", () => addQuizQuestion(qList));
      el.querySelector(".cb-body").appendChild(qList);
      el.querySelector(".cb-body").appendChild(addQBtn);

      const questions = existing?.questions || [];
      if (questions.length) {
        questions.forEach((q) => addQuizQuestion(qList, q));
      } else if (!existing) {
        addQuizQuestion(qList);
      }
    }
  }

  function addQuizQuestion(qList, existing) {
    quizQCounter++;
    const groupName = "cbq-" + quizQCounter;
    const row = document.createElement("div");
    row.className = "lesson-row";
    row.style.cssText = "display:block; padding:12px; background:var(--bg-3); border-radius:8px; margin-bottom:10px;";
    row.innerHTML = `
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
        <input type="text" class="q-text" placeholder="Question text" value="${Admin.escapeHtml(existing?.question || "")}" style="flex:1; background:var(--bg-2); border:1px solid var(--line-strong); border-radius:6px; padding:7px 9px; color:var(--text);">
        <button type="button" class="icon-btn remove-question" title="Remove question">✕</button>
      </div>
      <div class="q-options"></div>
      <button type="button" class="btn btn-ghost btn-sm add-option">+ Add option</button>`;
    qList.appendChild(row);

    row.querySelector(".remove-question").addEventListener("click", () => row.remove());
    const optWrap = row.querySelector(".q-options");
    row.querySelector(".add-option").addEventListener("click", () => addQuizOption(optWrap, groupName));

    const options = existing?.options || [];
    if (options.length) {
      options.forEach((optText, i) => addQuizOption(optWrap, groupName, optText, i === (existing.correct_index ?? 0)));
    } else {
      addQuizOption(optWrap, groupName, "", true);
      addQuizOption(optWrap, groupName, "", false);
    }
  }

  function addQuizOption(optWrap, groupName, text, isCorrect) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; gap:8px; align-items:center; margin-bottom:6px;";
    row.innerHTML = `
      <input type="radio" name="${groupName}" class="opt-correct" ${isCorrect ? "checked" : ""} title="Correct answer">
      <input type="text" class="opt-text" placeholder="Option text" value="${Admin.escapeHtml(text || "")}" style="flex:1; background:var(--bg-2); border:1px solid var(--line-strong); border-radius:6px; padding:6px 9px; color:var(--text); font-size:.85rem;">
      <button type="button" class="icon-btn remove-option">✕</button>`;
    optWrap.appendChild(row);
    row.querySelector(".remove-option").addEventListener("click", () => row.remove());
  }

  function collectContentBlocks() {
    return Array.from(document.querySelectorAll("#contentBlockList > .module-block")).map((el) => {
      const type = el.dataset.type;
      const base = { id: el.dataset.blockId, type, title: el.querySelector(".cb-title").value.trim() || (BLOCK_TYPES[type] || "Untitled") };

      if (type === "quiz") {
        base.questions = Array.from(el.querySelectorAll(".quiz-editor-list > div")).map((qRow) => {
          const options = Array.from(qRow.querySelectorAll(".q-options > div"));
          const optionTexts = options.map((o) => o.querySelector(".opt-text").value.trim());
          let correctIndex = options.findIndex((o) => o.querySelector(".opt-correct").checked);
          if (correctIndex < 0) correctIndex = 0;
          return { question: qRow.querySelector(".q-text").value.trim(), options: optionTexts, correct_index: correctIndex };
        }).filter((q) => q.question && q.options.some((o) => o));
        return base;
      }

      el.querySelectorAll(".cb-field").forEach((input) => { base[input.dataset.field] = input.value.trim(); });
      return base;
    });
  }

  function closeModal() {
    const el = document.getElementById("courseModal");
    if (el) el.remove();
  }

  /* One rule per field, each with its own message — "Bangla title is missing"
     can only ever mean f_title_bn is blank. */
  const COURSE_RULES = [
    { id: "f_title_bn", label: "Bangla title", message: "Bangla title is missing. This is the title shown to visitors on the site." },
    { id: "f_title_en", label: "English title", message: "English title is missing." },
    { id: "f_slug", label: "Link on the site", message: "Link on the site is missing. It is normally filled in for you from the title." },
    {
      id: "f_price",
      label: "Price",
      message: "Price must be a number — use 0, or tick “This course is free”.",
      test: (v) => v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0,
    },
    {
      id: "f_rating",
      label: "Rating",
      message: "Rating must be between 0 and 5.",
      test: (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 5),
    },
    {
      id: "f_purchase_url",
      label: "Purchase form URL",
      // Blank is valid and meaningful: it falls back to the site-wide form. A
      // half-typed URL is not, and would send buyers nowhere.
      message: "Enter the full link, starting with https:// — or leave it blank to use the site-wide enrollment form.",
      test: (v) => v.trim() === "" || /^https?:\/\/\S+$/i.test(v.trim()),
    },
  ];

  async function saveCourse(e) {
    e.preventDefault();

    // Validated before the button locks or any image uploads, so a rejected
    // save never leaves an orphaned file in storage.
    const missing = Admin.validateFields(document.getElementById("courseForm"), COURSE_RULES);
    if (missing.length) {
      Admin.toast(Admin.missingSummary(missing), true);
      return;
    }

    const btn = document.getElementById("saveCourseBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      let thumbnail_url = editingId ? courses.find((x) => x.id === editingId)?.thumbnail_url || null : null;
      const fileInput = document.getElementById("f_image");
      if (fileInput.files[0]) {
        thumbnail_url = await Admin.uploadImage(fileInput.files[0], "courses");
      }

      let mentor_avatar_url = editingId ? courses.find((x) => x.id === editingId)?.mentor?.avatar_url || "" : "";
      const mentorFileInput = document.getElementById("f_mentor_avatar");
      if (mentorFileInput.files[0]) {
        mentor_avatar_url = await Admin.uploadImage(mentorFileInput.files[0], "mentors");
      }

      const selectedTone = document.querySelector("#tonePicker button.selected");

      const payload = {
        // title_bn is NOT NULL in the database — never send an explicit null.
        title_bn: document.getElementById("f_title_bn").value.trim(),
        title_en: document.getElementById("f_title_en").value.trim() || null,
        slug: Admin.slugifyOrFallback("course", document.getElementById("f_slug").value),
        description_en: document.getElementById("f_desc_en").value.trim(),
        category: document.getElementById("f_category").value.trim() || "general",
        duration_en: document.getElementById("f_duration").value.trim(),
        price_bdt: parseInt(document.getElementById("f_price").value || "0", 10),
        is_free: document.getElementById("f_free").checked,
        // Blank saves as null, which is what makes the front end fall back to
        // the site-wide enrollment form rather than linking nowhere.
        purchase_url: document.getElementById("f_purchase_url").value.trim() || null,
        reviews_enabled: document.getElementById("f_reviews").checked,
        rating: parseFloat(document.getElementById("f_rating").value || "4.8"),
        tone: selectedTone ? parseInt(selectedTone.dataset.tone, 10) : 1,
        thumbnail_url,
        sort_order: parseInt(document.getElementById("f_sort").value || "0", 10),
        is_published: document.getElementById("f_published").checked,
        content_blocks: collectContentBlocks(),
        includes: collectIncludes(),
        faqs: collectFaqs(),
        mentor: {
          name: document.getElementById("f_mentor_name").value.trim(),
          bio: document.getElementById("f_mentor_bio").value.trim(),
          avatar_url: mentor_avatar_url,
        },
      };

      let res;
      if (editingId) {
        res = await c.from("courses").update(payload).eq("id", editingId);
      } else {
        res = await c.from("courses").insert(payload);
      }
      if (res.error) throw res.error;

      Admin.toast(editingId ? "Course updated." : "Course created.");
      closeModal();
      await loadCourses();
    } catch (err) {
      // Server rejections get pinned to the field that caused them too, so
      // the admin never has to decode a Postgres error into a form box.
      const byColumn = { title_bn: "f_title_bn", title_en: "f_title_en", slug: "f_slug", price_bdt: "f_price" };
      let handled = false;

      if (err.code === "23505") {
        Admin.showFieldError(document.getElementById("f_slug"), "Another course already uses this link. Change it to something unique.");
        Admin.toast("That link is already taken by another course.", true);
        handled = true;
      } else if (err.code === "23502") {
        const column = (err.message || "").match(/column "([a-z_]+)"/);
        const target = column && byColumn[column[1]];
        if (target) {
          Admin.showFieldError(document.getElementById(target), "This field can't be empty.");
          Admin.toast("A required field was left empty.", true);
          handled = true;
        }
      }
      // A database still on an older schema has no purchase_url /
      // reviews_enabled column, and Postgres only says "column not found" —
      // which reads like a bug in the panel rather than a migration you
      // haven't run yet.
      if (!handled && (err.code === "42703" || err.code === "PGRST204")) {
        Admin.toast("This database is missing a column the form saves. Run the latest schema.sql (sections 22–23) in the Supabase SQL editor, then try again.", true);
        handled = true;
      }
      if (!handled) Admin.toast("Couldn't save: " + (err.message || err), true);

      btn.disabled = false;
      btn.textContent = editingId ? "Save changes" : "Create course";
    }
  }
})();
