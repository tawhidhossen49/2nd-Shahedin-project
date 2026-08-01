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

  // The sidebar counters next to this are Bangla numerals; the percentage
  // should not be the one Latin figure in the panel.
  const BN_DIGITS = ["০","১","২","৩","৪","৫","৬","৭","৮","৯"];
  const bn = (v) => String(v).replace(/[0-9]/g, (d) => BN_DIGITS[+d]);

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

      if (!course.free) {
        window.location.href = `checkout.html?course=${encodeURIComponent(course.slug)}`;
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
        /* courses_safe was fetched once at page load, when this student was
           not yet enrolled — so every block arrived as {id,type,title,locked}.
           Without re-pulling it the buy card would go green and the toast
           would fire while the pane still read "ভর্তি হতে হবে" and every row
           kept its padlock, and "কোর্স শুরু করুন" would scroll the student
           straight to that contradiction. */
        let refreshed = false;
        if (window.ShahedinCourse && typeof window.ShahedinCourse.refresh === "function") {
          refreshed = await window.ShahedinCourse.refresh();
        }
        if (!refreshed) { window.location.reload(); return; }
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
    /* The hero preview duplicates lesson 1 for a student who already owns the
       course, at a larger size than the real player and with no connection to
       progress. Hidden via this class rather than :has() so it is deterministic
       on every engine. */
    const heroGrid = document.querySelector(".course-hero-grid");
    if (heroGrid) heroGrid.classList.toggle("is-enrolled-view", !!enrollment);

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
    // Published so js/render.js can resume at the first unfinished lesson
    // instead of always restarting the player at lesson 1.
    window.SHAHEDIN_COMPLETED_BLOCKS = completed;
    const total = blocks.length;
    const done = blocks.filter((el) => completed.includes(el.dataset.blockId)).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    /* The bar is built ONCE and mutated afterwards. It used to be re-created
       from scratch on every paint, so the new node always rendered at its
       final size and could never animate — no start value to move from.
       It animates transform:scaleX rather than width, so the fill stays off
       the layout path (transform-origin:left is already on .progress-fill). */
    if (summaryMount) {
      let fill = summaryMount.querySelector(".progress-fill");
      if (!fill) {
        summaryMount.innerHTML = `
          <div class="progress-summary">
            <div class="progress-summary-head"><span>আপনার অগ্রগতি</span><span data-progress-pct>${bn(pct)}%</span></div>
            <div class="progress-track"><div class="progress-fill"></div></div>
          </div>`;
        fill = summaryMount.querySelector(".progress-fill");
      }
      const pctEl = summaryMount.querySelector("[data-progress-pct]");
      if (pctEl) pctEl.textContent = bn(pct) + "%";
      if (fill) fill.style.transform = "scaleX(" + (pct / 100).toFixed(4) + ")";
      const summary = summaryMount.querySelector(".progress-summary");
      if (summary) summary.classList.toggle("is-complete", total > 0 && done === total);
    }

    blocks.forEach((el) => {
      const blockId = el.dataset.blockId;
      const isDone = completed.includes(blockId);
      /* Only a quiz that can actually be TAKEN is exempt from the checkbox.
         A quiz saved with no questions renders no "check answers" button, so
         quiz-checked could never fire for it and its id could never enter
         completed_blocks — while it still counted toward `total`, which left
         the whole course permanently stuck below 100%. render.js flags the
         scorable ones with data-quiz-scored, so an empty quiz now falls
         through to the ordinary checkbox and stays completable by hand. */
      if (el.dataset.blockType === "quiz" && el.dataset.quizScored === "1") {
        if (isDone && !el.querySelector(".cb-done-badge")) {
          const badge = document.createElement("span");
          badge.className = "badge badge-live cb-done-badge";
          badge.style.marginLeft = "10px";
          badge.textContent = "সম্পন্ন ✓";
          const titleEl = el.querySelector(".cb-title");
          if (titleEl) titleEl.appendChild(badge);
        }
        return;
      }
      // Locked rows carry no control at all now, so this also stops a padlocked
      // lesson from offering a working "mark complete" checkbox.
      const control = el.querySelector("[data-cb-progress]");
      if (!control) return;
      control.hidden = false;
      const checkbox = control.querySelector(".cb-complete-check");
      if (!checkbox) return;
      checkbox.checked = isDone;
      if (!checkbox.dataset.wired) {
        checkbox.dataset.wired = "1";
        checkbox.addEventListener("change", () => markComplete(course, blockId, checkbox.checked));
      }
    });

    /* Setting checkbox.checked above fires no change event, so the player's
       per-section counters would never learn about it. It used to try a
       setTimeout(…, 0), which lost the race against the two awaited network
       calls in init() every time and left a returning student looking at ০/N
       under an ৮০% bar. */
    document.dispatchEvent(new Event("course-progress-painted"));
  }

  async function markComplete(course, blockId, isComplete) {
    if (!enrollment) return;
    const current = Array.isArray(enrollment.completed_blocks) ? enrollment.completed_blocks : [];
    const next = isComplete ? Array.from(new Set([...current, blockId])) : current.filter((id) => id !== blockId);
    const total = document.querySelectorAll("[data-block-id]").length;
    const nowComplete = total > 0 && next.length >= total;
    const wasComplete = !!enrollment.completed;

    enrollment.completed_blocks = next; // optimistic local update
    enrollment.completed = nowComplete;
    enrollment.completed_at = nowComplete ? enrollment.completed_at || new Date().toISOString() : null;
    paintProgress(course);

    try {
      const c = window.ShahedinAuth.client();
      const { error } = await c
        .from("enrollments")
        .update({ completed_blocks: next, completed: nowComplete, completed_at: enrollment.completed_at })
        .eq("id", enrollment.id);
      if (error) throw error;
      if (nowComplete && !wasComplete) {
        window.showToast && window.showToast("অভিনন্দন! আপনি কোর্সটি সম্পন্ন করেছেন — এখন একটি রিভিউ দিতে পারবেন।");
      }
      if (nowComplete !== wasComplete) {
        document.dispatchEvent(new CustomEvent("course-completion-changed", { detail: { completed: nowComplete } }));
      }
    } catch (err) {
      window.showToast && window.showToast("অগ্রগতি সংরক্ষণ করা যায়নি, আবার চেষ্টা করুন।");
    }
  }

  document.addEventListener("course-mounted", init);
})();
