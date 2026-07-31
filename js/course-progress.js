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

  function paintEnrollButton(btn, course, loggedIn) {
    if (enrollment) {
      btn.textContent = "ভর্তি হয়েছেন ✓";
      btn.disabled = true;
      return;
    }
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
