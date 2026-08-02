/* =========================================================
   course-reviews.js
   ---------------------------------------------------------
   Runs on course-detail.html. Shows the reviews the admin has
   chosen to publish for this course, and — only for students
   who are enrolled AND have marked every lesson complete —
   lets them submit or edit their own review. Eligibility is
   also enforced server-side (see course_reviews RLS policies
   in schema.sql), so this is a UI convenience, not the actual
   security boundary.
   ========================================================= */
(function () {
  "use strict";

  let myReview = null; // the signed-in student's own review row for this course, if any
  let isCompleted = false;

  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function starsDisplay(rating) {
    const full = Math.round(rating);
    return "★".repeat(full) + "☆".repeat(5 - full);
  }

  async function init() {
    const course = window.SHAHEDIN_CURRENT_COURSE;
    const reviewsMount = document.querySelector("[data-mount='course-reviews']");
    const formMount = document.querySelector("[data-mount='course-review-form']");
    if (!course || !reviewsMount) return;

    if (!course.dbId || !(window.ShahedinAuth && window.ShahedinAuth.configured())) {
      reviewsMount.innerHTML = `<p class="small-note">এখনো কোনো রিভিউ নেই।</p>`;
      return;
    }

    const c = window.ShahedinAuth.client();

    // Approved reviews — visible to everyone.
    const { data: approved } = await c
      .from("course_reviews")
      .select("*")
      .eq("course_id", course.dbId)
      .eq("is_approved", true)
      .order("created_at", { ascending: false });
    renderApprovedReviews(reviewsMount, approved || []);

    // The signed-in student's own eligibility + existing review, if any.
    const user = await window.ShahedinAuth.getUser();
    if (user && formMount) {
      const [{ data: enrollment }, { data: ownReview }] = await Promise.all([
        c.from("enrollments").select("completed").eq("user_id", user.id).eq("course_id", course.dbId).maybeSingle(),
        c.from("course_reviews").select("*").eq("user_id", user.id).eq("course_id", course.dbId).maybeSingle(),
      ]);
      isCompleted = !!(enrollment && enrollment.completed);
      myReview = ownReview || null;
      renderFormArea(formMount, course, user);
    } else if (formMount) {
      formMount.innerHTML = "";
    }

    document.addEventListener("course-completion-changed", async (e) => {
      isCompleted = !!e.detail.completed;
      const authedUser = await window.ShahedinAuth.getUser();
      if (authedUser && formMount) renderFormArea(formMount, course, authedUser);
    });
  }

  function renderApprovedReviews(mount, reviews) {
    if (!reviews.length) {
      mount.innerHTML = `<p class="small-note">এখনো কোনো রিভিউ নেই।</p>`;
      return;
    }
    mount.innerHTML = reviews
      .map(
        (r) => `
      <div class="t-card" style="max-width:none; margin-bottom:14px;">
        <p class="t-quote" style="color:var(--accent-2); font-size:.85rem; letter-spacing:1px; font-style:normal;">${starsDisplay(r.rating)}</p>
        <p class="t-quote">"${escapeHtml(r.review_text)}"</p>
        <div class="t-person"><div class="t-avatar">${escapeHtml((r.student_name || "?").slice(0, 1))}</div><div><div class="t-name">${escapeHtml(r.student_name)}</div><div class="t-role">যাচাইকৃত শিক্ষার্থী</div></div></div>
      </div>`
      )
      .join("");
  }

  function renderFormArea(mount, course, user) {
    if (!isCompleted && !myReview) {
      mount.innerHTML = `<div class="review-note">কোর্সটি সম্পূর্ণ করার পর আপনি এখানে একটি রিভিউ দিতে পারবেন।</div>`;
      return;
    }

    if (myReview && !mount.dataset.editing) {
      const statusBadge = myReview.is_approved
        ? `<span class="review-status-badge approved">প্রকাশিত</span>`
        : `<span class="review-status-badge pending">অনুমোদনের অপেক্ষায়</span>`;
      mount.innerHTML = `
        <div class="review-form-card">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div><span style="color:var(--accent-2); letter-spacing:1px;">${starsDisplay(myReview.rating)}</span>${statusBadge}</div>
            <button type="button" class="btn btn-ghost btn-sm" id="editReviewBtn">এডিট করুন</button>
          </div>
          <p style="font-size:.9rem; color:var(--text-muted); margin-top:10px;">"${escapeHtml(myReview.review_text)}"</p>
        </div>`;
      document.getElementById("editReviewBtn").addEventListener("click", () => {
        mount.dataset.editing = "1";
        renderFormArea(mount, course, user);
      });
      return;
    }

    const initialRating = myReview ? myReview.rating : 0;
    mount.innerHTML = `
      <div class="review-form-card">
        <label style="font-size:.85rem; font-weight:600; display:block; margin-bottom:8px;">আপনার রেটিং</label>
        <div class="star-picker" data-star-picker>
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= initialRating ? "active" : ""}">★</button>`).join("")}
        </div>
        <textarea id="reviewTextInput" placeholder="কোর্সটি নিয়ে আপনার অভিজ্ঞতা লিখুন…">${myReview ? escapeHtml(myReview.review_text) : ""}</textarea>
        <button type="button" class="btn btn-primary btn-sm" id="submitReviewBtn">${myReview ? "রিভিউ আপডেট করুন" : "রিভিউ জমা দিন"}</button>
        <div class="small-note" id="reviewFormStatus" style="margin-top:8px; display:none;"></div>
      </div>`;

    let selectedRating = initialRating;
    const picker = mount.querySelector("[data-star-picker]");
    picker.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedRating = parseInt(btn.dataset.star, 10);
        picker.querySelectorAll("button").forEach((b) => b.classList.toggle("active", parseInt(b.dataset.star, 10) <= selectedRating));
      });
    });

    document.getElementById("submitReviewBtn").addEventListener("click", async () => {
      const text = document.getElementById("reviewTextInput").value.trim();
      const statusEl = document.getElementById("reviewFormStatus");
      if (!selectedRating) {
        statusEl.hidden = false;
        statusEl.textContent = "একটি রেটিং নির্বাচন করুন।";
        return;
      }
      if (!text) {
        statusEl.hidden = false;
        statusEl.textContent = "রিভিউ লিখুন।";
        return;
      }
      const btn = document.getElementById("submitReviewBtn");
      btn.disabled = true;
      btn.textContent = "জমা দেওয়া হচ্ছে…";
      try {
        const c = window.ShahedinAuth.client();
        const { data, error } = await c
          .from("course_reviews")
          .upsert(
            {
              course_id: course.dbId,
              user_id: user.id,
              student_name: window.ShahedinAuth.displayName(user),
              rating: selectedRating,
              review_text: text,
            },
            { onConflict: "course_id,user_id" }
          )
          .select()
          .single();
        if (error) throw error;
        myReview = data;
        delete mount.dataset.editing;
        renderFormArea(mount, course, user);
        window.showToast && window.showToast("রিভিউর জন্য ধন্যবাদ! এটি অ্যাডমিনের অনুমোদনের পর দেখা যাবে।");
      } catch (err) {
        statusEl.hidden = false;
        statusEl.textContent = "রিভিউ জমা দেওয়া যায়নি, আবার চেষ্টা করুন।";
        btn.disabled = false;
        btn.textContent = myReview ? "রিভিউ আপডেট করুন" : "রিভিউ জমা দিন";
      }
    });
  }

  document.addEventListener("course-mounted", init);
})();
