(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell(
    "reviews.html",
    "Reviews",
    "Real reviews submitted by students who completed a course. Choose which ones show up on the course page.",
    admin
  );
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading reviews…</div>`;

  const c = Admin.client();
  let reviews = [];
  let filter = "all"; // all | pending | approved

  await loadReviews();

  async function loadReviews() {
    const { data, error } = await c
      .from("course_reviews")
      .select("*, courses(title_en, title_bn)")
      .order("created_at", { ascending: false });
    if (error) {
      content.innerHTML = `<div class="notice">Couldn't load reviews: ${Admin.escapeHtml(error.message)}<br><br>
        Make sure you've run the latest <code>schema.sql</code> in the Supabase SQL editor — it adds the <code>course_reviews</code> table.</div>`;
      return;
    }
    reviews = data || [];
    render();
  }

  function render() {
    const filtered = reviews.filter((r) => (filter === "all" ? true : filter === "pending" ? !r.is_approved : r.is_approved));

    content.innerHTML = `
      <div class="filter-tabs" style="display:flex; gap:8px; margin-bottom:16px;">
        <button type="button" class="btn btn-sm ${filter === "all" ? "btn-primary" : "btn-ghost"}" data-filter="all">All (${reviews.length})</button>
        <button type="button" class="btn btn-sm ${filter === "pending" ? "btn-primary" : "btn-ghost"}" data-filter="pending">Pending (${reviews.filter((r) => !r.is_approved).length})</button>
        <button type="button" class="btn btn-sm ${filter === "approved" ? "btn-primary" : "btn-ghost"}" data-filter="approved">Approved (${reviews.filter((r) => r.is_approved).length})</button>
      </div>

      ${
        !filtered.length
          ? `<div class="notice">No reviews here yet.</div>`
          : `<table class="admin-table">
        <thead><tr><th>Course</th><th>Student</th><th>Rating</th><th>Review</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>
          ${filtered
            .map((r) => {
              const courseTitle = (r.courses && (r.courses.title_en || r.courses.title_bn)) || "(deleted course)";
              const date = new Date(r.created_at).toLocaleDateString();
              return `<tr data-id="${r.id}">
                <td>${Admin.escapeHtml(courseTitle)}</td>
                <td>${Admin.escapeHtml(r.student_name)}</td>
                <td>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</td>
                <td style="max-width:320px;"><span class="row-sub">${Admin.escapeHtml(r.review_text)}</span></td>
                <td>${r.is_approved ? '<span class="badge badge-live">Approved</span>' : '<span class="badge badge-draft">Pending</span>'}</td>
                <td class="row-sub">${date}</td>
                <td class="row-actions">
                  <button type="button" class="btn btn-ghost btn-sm" data-toggle="${r.id}">${r.is_approved ? "Unpublish" : "Approve"}</button>
                  <button type="button" class="icon-btn" data-delete="${r.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg></button>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`
      }`;

    content.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.dataset.filter;
        render();
      });
    });

    content.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => toggleApproval(btn.dataset.toggle, btn));
    });

    content.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteReview(btn.dataset.delete));
    });
  }

  async function toggleApproval(id, btn) {
    const review = reviews.find((r) => r.id === id);
    if (!review) return;
    btn.disabled = true;
    const { error } = await c.from("course_reviews").update({ is_approved: !review.is_approved }).eq("id", id);
    btn.disabled = false;
    if (error) {
      Admin.toast("Couldn't update: " + error.message, true);
      return;
    }
    review.is_approved = !review.is_approved;
    Admin.toast(review.is_approved ? "Review published." : "Review unpublished.");
    render();
  }

  async function deleteReview(id) {
    if (!confirm("Delete this review? This can't be undone.")) return;
    const { error } = await c.from("course_reviews").delete().eq("id", id);
    if (error) {
      Admin.toast("Couldn't delete: " + error.message, true);
      return;
    }
    reviews = reviews.filter((r) => r.id !== id);
    Admin.toast("Review deleted.");
    render();
  }
})();
