/* =========================================================
   course-progress.js
   ---------------------------------------------------------
   Runs on course-detail.html. Wires the "Enroll" button to a
   real enrollment (free courses enroll immediately; paid
   courses go to checkout), and — for students already
   enrolled — reveals per-block "mark as complete" controls,
   persists progress to Supabase, and shows a live progress bar.
   ========================================================= */
(function () {
  "use strict";

  let enrollment = null; // the student's enrollments row for this course, if any

  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  async function init() {
    const course = window.SHAHEDIN_CURRENT_COURSE;
    const enrollBtn = document.querySelector("[data-enroll]");
    if (!course || !enrollBtn) return;

    if (!course.dbId) {
      // Site isn't connected to Supabase yet, or this course only exists in the
      // static sample data — enrollment can't be tracked for real.
      enrollBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.showToast && window.showToast("এই কোর্সে ভর্তি হতে সাইটটিকে Supabase-এর সাথে সংযুক্ত হতে হবে।");
      });
      return;
    }

    const user = await (window.ShahedinAuth ? window.ShahedinAuth.getUser() : null);
    if (user) await loadEnrollment(user, course);
    paintEnrollButton(enrollBtn, course, !!user);
    paintProgress(course);
    wireVideoProgress(course);

    enrollBtn.addEventListener("click", async () => {
      if (enrollment) return; // already enrolled, button is disabled anyway
      enrollBtn.disabled = true;
      const originalText = enrollBtn.textContent;
      enrollBtn.textContent = "একটু অপেক্ষা করুন…";

      const authedUser = await window.ShahedinAuth.requireAuth();
      if (!authedUser) {
        enrollBtn.disabled = false;
        enrollBtn.textContent = originalText;
        return;
      }

      /* Paid course. There is no payment gateway, so buying does not happen on
         this site at all. The student is sent to an external enrolment form
         (a Google Form), which carries the payment instructions; they send the
         money off-site and the admin grants access from Admin -> Students once
         the payment is verified.

         requireAuth() above is what makes the "log in first, then the form"
         order work: an anonymous visitor gets the login modal and only lands
         on the form once there is an account for the admin to grant access to.

         Free courses never reach this branch, and products still go through
         checkout.html untouched. */
      if (!course.free) {
        const form = await enrollmentFormUrl(course);
        if (form) {
          window.location.href = form;
          return;
        }
        /* Nothing configured anywhere. Previously this fell through to
           checkout.html, which offered a bKash payment that cannot be
           completed — a dead end dressed up as a purchase. Say so instead. */
        enrollBtn.disabled = false;
        enrollBtn.textContent = originalText;
        window.showToast && window.showToast("এই কোর্সের ভর্তি ফর্ম এখনো যুক্ত করা হয়নি। অনুগ্রহ করে আমাদের সাথে যোগাযোগ করুন।");
        return;
      }

      try {
        const c = window.ShahedinAuth.client();
        const { data, error } = await c
          .from("enrollments")
          .upsert({ user_id: authedUser.id, course_id: course.dbId }, { onConflict: "user_id,course_id" })
          .select()
          .single();
        if (error) throw error;
        enrollment = data;
        paintEnrollButton(enrollBtn, course, true);
        paintProgress(course);
        window.showToast && window.showToast("ভর্তি সম্পন্ন হয়েছে! এখন আপনি কোর্সের অগ্রগতি ট্র্যাক করতে পারবেন।");
      } catch (err) {
        enrollBtn.disabled = false;
        enrollBtn.textContent = originalText;
        window.showToast && window.showToast("ভর্তি হতে সমস্যা হয়েছে, আবার চেষ্টা করুন।");
      }
    });

    document.addEventListener("quiz-checked", async (e) => {
      if (!enrollment || !e.detail || !e.detail.blockId) return;
      await markComplete(course, e.detail.blockId, true);
    });
  }

  /* Where the buy button sends a student for a paid course.

     Two levels, so the admin can work either way:
       1. the course's own "Purchase / enrollment form URL" field, and
       2. the site-wide default in Settings -> Course enrollment,
     with the per-course value winning when both are set. The default is what
     makes a newly created paid course work without remembering to paste the
     link again; the override is for a course that needs its own form.

     Only http(s) is accepted. The admin field is free text, and a stray
     "javascript:" in it must not become a live link on the buy button. */
  async function enrollmentFormUrl(course) {
    const own = String(course.purchaseUrl || "").trim();
    if (/^https?:\/\/\S+$/i.test(own)) return own;

    let fallback = "";
    try {
      const settings = window.SiteSettings ? await window.SiteSettings.ready() : null;
      fallback = String((settings && settings.enrollment && settings.enrollment.form_url) || "").trim();
    } catch (err) {
      fallback = ""; // settings unreachable — treated as "not configured"
    }
    return /^https?:\/\/\S+$/i.test(fallback) ? fallback : "";
  }

  async function loadEnrollment(user, course) {
    const c = window.ShahedinAuth.client();
    const { data } = await c.from("enrollments").select("*").eq("user_id", user.id).eq("course_id", course.dbId).maybeSingle();
    enrollment = data || null;
  }

  /* The whole buy card changes state, not just the button.
     Previously the button said "ভর্তি হয়েছেন ✓" while the price and the
     "একবার পেমেন্ট, আজীবন অ্যাক্সেস" line sat right above it, still selling
     a course the visitor had already bought. .is-enrolled hides the price
     row, swaps the accent for the confirmation green and reveals the
     enrolled banner (see .course-buy-card.is-enrolled in css/style.css). */
  function paintEnrollButton(btn, course, loggedIn) {
    const card = btn.closest(".course-buy-card") || document.querySelector("[data-mount='course-buy']");

    if (enrollment) {
      btn.textContent = "ভর্তি হয়েছেন ✓";
      btn.disabled = true;
      if (card) {
        card.classList.add("is-enrolled");
        // Point the primary action at the curriculum instead of a dead button.
        if (!card.querySelector("[data-goto-curriculum]")) {
          const go = document.createElement("a");
          go.className = "btn btn-primary btn-block";
          go.style.marginTop = "14px";
          go.href = "#course-curriculum";
          go.setAttribute("data-goto-curriculum", "");
          go.textContent = "কোর্স শুরু করুন";
          btn.insertAdjacentElement("afterend", go);
          btn.hidden = true;
        }
      }
      return;
    }

    if (card) card.classList.remove("is-enrolled");
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = course.free ? "ফ্রি-তে ভর্তি হোন" : "এখনই কিনুন";
  }

  function paintProgress(course) {
    const summaryMount = document.querySelector("[data-mount='course-progress-summary']");
    const blocks = Array.from(document.querySelectorAll("[data-block-id]"));

    if (!enrollment) {
      if (summaryMount) summaryMount.innerHTML = "";
      return; // leave content blocks as a plain preview — no progress controls
    }

    const completed = Array.isArray(enrollment.completed_blocks) ? enrollment.completed_blocks : [];
    const total = blocks.length;
    const done = blocks.filter((el) => completed.includes(el.dataset.blockId)).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    if (summaryMount) {
      summaryMount.innerHTML = `
        <div class="progress-summary">
          <div class="progress-summary-head"><span>আপনার অগ্রগতি</span><span>${pct}%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
        </div>`;
    }

    blocks.forEach((el) => {
      const blockId = el.dataset.blockId;
      const isDone = completed.includes(blockId);
      if (el.dataset.blockType === "quiz") {
        if (isDone && !el.querySelector(".cb-done-badge")) {
          const badge = document.createElement("span");
          badge.className = "badge badge-live cb-done-badge";
          badge.style.marginLeft = "10px";
          badge.textContent = "সম্পন্ন ✓";
          el.querySelector(".cb-title").appendChild(badge);
        }
        return;
      }
      const control = el.querySelector("[data-cb-progress]");
      if (!control) return;
      control.hidden = false;
      const checkbox = control.querySelector(".cb-complete-check");
      checkbox.checked = isDone;
      if (!checkbox.dataset.wired) {
        checkbox.dataset.wired = "1";
        checkbox.addEventListener("change", () => markComplete(course, blockId, checkbox.checked));
      }
    });

    /* Signals that the enrollment is loaded and its saved positions are
       readable. js/video-progress.js waits for this before attaching to any
       player, so a video never starts from zero just because the network was
       slower than the render. */
    document.dispatchEvent(new Event("course-progress-painted"));
  }

  /* ---------- The one and only writer ----------
     completed_blocks and block_progress live on the SAME enrollments row.
     Two independent .update() calls would each send their own snapshot of the
     row and the later one would silently undo the earlier: ticking a checkbox
     mid-video would wipe the watch position, or a video save would resurrect a
     block the student had just un-ticked. Everything goes through here, so
     each write carries both fields and they can never disagree. */
  async function persist(course, opts) {
    if (!enrollment) return;
    const wasComplete = !!enrollment.completed;
    const total = document.querySelectorAll("[data-block-id]").length;
    const done = Array.isArray(enrollment.completed_blocks) ? enrollment.completed_blocks : [];
    const nowComplete = total > 0 && done.length >= total;

    enrollment.completed = nowComplete;
    enrollment.completed_at = nowComplete ? enrollment.completed_at || new Date().toISOString() : null;
    if (opts && opts.repaint !== false) paintProgress(course);

    try {
      const c = window.ShahedinAuth.client();
      const { error } = await c
        .from("enrollments")
        .update({
          completed_blocks: done,
          completed: nowComplete,
          completed_at: enrollment.completed_at,
          block_progress: enrollment.block_progress || {},
        })
        .eq("id", enrollment.id);
      if (error) throw error;

      if (nowComplete && !wasComplete) {
        window.showToast && window.showToast("অভিনন্দন! আপনি কোর্সটি সম্পন্ন করেছেন — এখন একটি রিভিউ দিতে পারবেন।");
      }
      if (nowComplete !== wasComplete) {
        document.dispatchEvent(new CustomEvent("course-completion-changed", { detail: { completed: nowComplete } }));
      }
    } catch (err) {
      // A database still on the old schema has no block_progress column.
      console.warn(
        "Shahedin: couldn't save progress. If this says block_progress does not exist, " +
        "run section 21 of schema.sql in the Supabase SQL editor.",
        err
      );
      if (!opts || !opts.quiet) {
        window.showToast && window.showToast("অগ্রগতি সংরক্ষণ করা যায়নি, আবার চেষ্টা করুন।");
      }
    }
  }

  async function markComplete(course, blockId, isComplete) {
    if (!enrollment) return;
    const current = Array.isArray(enrollment.completed_blocks) ? enrollment.completed_blocks : [];
    const next = isComplete ? Array.from(new Set([...current, blockId])) : current.filter((id) => id !== blockId);
    if (next.length === current.length && isComplete) return; // already done, nothing to write
    enrollment.completed_blocks = next; // optimistic local update
    await persist(course);
  }

  /* ---------- Video watch progress ----------
     js/video-progress.js measures playback and emits events; it deliberately
     does not touch Supabase itself, for the reason in persist() above. */
  function wireVideoProgress(course) {
    let timer = null;

    document.addEventListener("video-progress", (e) => {
      if (!enrollment || !e.detail || !e.detail.blockId) return;
      const { blockId, pos, dur, pct } = e.detail;
      enrollment.block_progress = Object.assign({}, enrollment.block_progress, {
        [blockId]: { pos: Math.round(pos * 10) / 10, dur: Math.round(dur * 10) / 10, pct: Math.round(pct) },
      });
      // Debounced: a pause and a seek land within milliseconds of each other,
      // and a watch position is not worth a request per event. Quiet, because
      // a background save failing should not interrupt someone watching.
      clearTimeout(timer);
      timer = setTimeout(() => persist(course, { repaint: false, quiet: true }), 1500);
    });

    document.addEventListener("video-complete", (e) => {
      if (!enrollment || !e.detail || !e.detail.blockId) return;
      markComplete(course, e.detail.blockId, true);
    });
  }

  // Read back by video-progress.js to decide where to resume from.
  window.ShahedinProgress = {
    blockProgress(blockId) {
      const all = (enrollment && enrollment.block_progress) || {};
      return all[blockId] || null;
    },
  };

  document.addEventListener("course-mounted", init);
})();
