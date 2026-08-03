/* =========================================================
   admin-submissions.js
   ---------------------------------------------------------
   "Contact Messages" — every message sent through the form on
   contact.html lands here.

   What the admin can do:
     * read the full message (click any row)
     * reply — opens their email client, pre-addressed
     * mark read / unread, star the important ones
     * keep private admin notes against a message
     * delete a single message
     * bulk-delete: selected, all read, or absolutely everything
     * export the whole list to a CSV for a spreadsheet

   Visitors can only INSERT into contact_submissions, never
   SELECT — so nothing here is readable by the public.
   ========================================================= */
(async function () {
  "use strict";

  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell(
    "submissions.html",
    "Contact Messages",
    "Messages sent through the contact form on the website. Newest first.",
    admin
  );

  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading messages…</div>`;

  const c = Admin.client();

  const TYPE_LABELS = {
    general: "General",
    partnership: "Partnership",
    speaking: "Speaking",
    press: "Press",
  };

  let submissions = [];
  let filter = "all"; // all | unread | starred
  let search = "";
  const selected = new Set();

  await loadSubmissions();

  /* ============================================================
     Loading
     ============================================================ */
  async function loadSubmissions() {
    const { data, error } = await c
      .from("contact_submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      content.innerHTML = `<div class="notice">Couldn't load messages: ${Admin.escapeHtml(error.message)}<br><br>
        If this is the first time you're opening this page, run the latest <code>schema.sql</code> in the
        Supabase SQL editor — it adds the <code>contact_submissions</code> table that the contact form writes to.</div>`;
      return;
    }

    submissions = data || [];
    // Drop any selections for rows that no longer exist.
    Array.from(selected).forEach((id) => {
      if (!submissions.some((s) => s.id === id)) selected.delete(id);
    });
    render();
  }

  /* ============================================================
     Filtering
     ============================================================ */
  function visibleRows() {
    const q = search.trim().toLowerCase();
    return submissions.filter((s) => {
      if (filter === "unread" && s.is_read) return false;
      if (filter === "starred" && !s.is_starred) return false;
      if (!q) return true;
      return [s.name, s.email, s.message, s.inquiry_type, s.admin_notes]
        .map((v) => (v || "").toString().toLowerCase())
        .some((v) => v.includes(q));
    });
  }

  /* ============================================================
     Rendering
     ============================================================ */
  function render() {
    const rows = visibleRows();
    const unreadCount = submissions.filter((s) => !s.is_read).length;
    const starredCount = submissions.filter((s) => s.is_starred).length;
    const readCount = submissions.filter((s) => s.is_read).length;

    content.innerHTML = `
      <div class="stat-grid" style="margin-bottom:20px;">
        <div class="stat-card"><div class="label">Total messages</div><div class="value">${submissions.length}</div></div>
        <div class="stat-card"><div class="label">Unread</div><div class="value">${unreadCount}</div><div class="sub">${unreadCount ? "waiting for a reply" : "all caught up"}</div></div>
        <div class="stat-card"><div class="label">Starred</div><div class="value">${starredCount}</div></div>
        <div class="stat-card"><div class="label">Last 7 days</div><div class="value">${countSince(7)}</div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>Inbox</h2><p>Click a message to read it in full, reply, or add a private note.</p></div>
          <div class="row-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="refreshBtn">Refresh</button>
            <button type="button" class="btn btn-ghost btn-sm" id="exportBtn" ${submissions.length ? "" : "disabled"}>Export CSV</button>
          </div>
        </div>

        <div class="sub-toolbar">
          <div class="filter-tabs">
            <button type="button" class="btn btn-sm ${filter === "all" ? "btn-primary" : "btn-ghost"}" data-filter="all">All (${submissions.length})</button>
            <button type="button" class="btn btn-sm ${filter === "unread" ? "btn-primary" : "btn-ghost"}" data-filter="unread">Unread (${unreadCount})</button>
            <button type="button" class="btn btn-sm ${filter === "starred" ? "btn-primary" : "btn-ghost"}" data-filter="starred">Starred (${starredCount})</button>
          </div>
          <input type="search" id="searchBox" class="sub-search" placeholder="Search name, email or message…" value="${Admin.escapeHtml(search)}">
        </div>

        ${
          selected.size
            ? `<div class="bulk-bar">
                 <span><strong>${selected.size}</strong> selected</span>
                 <div class="row-actions">
                   <button type="button" class="btn btn-ghost btn-sm" id="markSelectedRead">Mark as read</button>
                   <button type="button" class="btn btn-danger btn-sm" id="deleteSelected">Delete selected</button>
                   <button type="button" class="btn btn-ghost btn-sm" id="clearSelection">Cancel</button>
                 </div>
               </div>`
            : ""
        }

        ${
          !submissions.length
            ? `<div class="empty-state">
                 <h3>No messages yet</h3>
                 <p>When someone fills in the form on the contact page, their message will appear here automatically.</p>
               </div>`
            : !rows.length
            ? `<div class="notice">No messages match this filter.</div>`
            : `<table class="admin-table sub-table">
                 <thead>
                   <tr>
                     <th style="width:34px;"><input type="checkbox" id="selectAll" ${allVisibleSelected(rows) ? "checked" : ""} title="Select all"></th>
                     <th style="width:34px;"></th>
                     <th>From</th>
                     <th>Type</th>
                     <th>Message</th>
                     <th>Received</th>
                     <th></th>
                   </tr>
                 </thead>
                 <tbody>
                   ${rows.map(rowHtml).join("")}
                 </tbody>
               </table>`
        }
      </div>

      ${
        submissions.length
          ? `<div class="panel danger-panel">
               <div class="panel-head">
                 <div><h2>Clear messages</h2><p>Deleting is permanent — messages cannot be recovered afterwards. Export a CSV first if you want a copy.</p></div>
               </div>
               <div class="row-actions">
                 <button type="button" class="btn btn-ghost btn-sm" id="clearReadBtn" ${readCount ? "" : "disabled"}>Delete read messages (${readCount})</button>
                 <button type="button" class="btn btn-danger btn-sm" id="clearAllBtn">Clear all ${submissions.length} messages</button>
               </div>
             </div>`
          : ""
      }`;

    wireUp();
  }

  function rowHtml(s) {
    const isNew = !s.is_read;
    const preview = (s.message || "").replace(/\s+/g, " ").slice(0, 110);
    const ellipsis = (s.message || "").length > 110 ? "…" : "";
    return `<tr data-id="${s.id}" class="sub-row ${isNew ? "is-unread" : ""}">
      <td><input type="checkbox" class="row-select" data-select="${s.id}" ${selected.has(s.id) ? "checked" : ""}></td>
      <td>
        <button type="button" class="star-btn ${s.is_starred ? "is-on" : ""}" data-star="${s.id}" title="${s.is_starred ? "Remove star" : "Star this message"}" aria-label="Star">${s.is_starred ? "★" : "☆"}</button>
      </td>
      <td class="row-title-cell" data-open="${s.id}">
        <div class="row-title">${Admin.escapeHtml(s.name)}${isNew ? ' <span class="badge badge-live">New</span>' : ""}</div>
        <div class="row-sub">${Admin.escapeHtml(s.email)}</div>
      </td>
      <td><span class="badge badge-draft">${Admin.escapeHtml(TYPE_LABELS[s.inquiry_type] || s.inquiry_type || "General")}</span></td>
      <td style="max-width:340px;" data-open="${s.id}"><span class="row-sub">${Admin.escapeHtml(preview)}${ellipsis}</span></td>
      <td class="row-sub" title="${Admin.escapeHtml(new Date(s.created_at).toLocaleString())}">${Admin.timeAgo(s.created_at)}</td>
      <td class="row-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-open="${s.id}">Open</button>
        <button type="button" class="icon-btn" data-delete="${s.id}" title="Delete message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>
        </button>
      </td>
    </tr>`;
  }

  function allVisibleSelected(rows) {
    return rows.length > 0 && rows.every((r) => selected.has(r.id));
  }

  function countSince(days) {
    const cutoff = Date.now() - days * 86400000;
    return submissions.filter((s) => new Date(s.created_at).getTime() >= cutoff).length;
  }

  /* ============================================================
     Event wiring
     ============================================================ */
  function wireUp() {
    const byId = (id) => document.getElementById(id);

    content.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.dataset.filter;
        render();
      });
    });

    const searchBox = byId("searchBox");
    if (searchBox) {
      searchBox.addEventListener("input", () => {
        search = searchBox.value;
        const start = searchBox.selectionStart;
        render();
        const again = byId("searchBox");
        if (again) {
          again.focus();
          again.setSelectionRange(start, start);
        }
      });
    }

    content.querySelectorAll("[data-open]").forEach((el) => {
      el.addEventListener("click", () => openMessage(el.dataset.open));
    });

    content.querySelectorAll("[data-star]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleStar(btn.dataset.star);
      });
    });

    content.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteOne(btn.dataset.delete);
      });
    });

    content.querySelectorAll("[data-select]").forEach((box) => {
      box.addEventListener("change", () => {
        if (box.checked) selected.add(box.dataset.select);
        else selected.delete(box.dataset.select);
        render();
      });
    });

    const selectAll = byId("selectAll");
    if (selectAll) {
      selectAll.addEventListener("change", () => {
        const rows = visibleRows();
        if (selectAll.checked) rows.forEach((r) => selected.add(r.id));
        else rows.forEach((r) => selected.delete(r.id));
        render();
      });
    }

    if (byId("clearSelection")) byId("clearSelection").addEventListener("click", () => { selected.clear(); render(); });
    if (byId("markSelectedRead")) byId("markSelectedRead").addEventListener("click", markSelectedRead);
    if (byId("deleteSelected")) byId("deleteSelected").addEventListener("click", deleteSelected);
    if (byId("clearReadBtn")) byId("clearReadBtn").addEventListener("click", deleteAllRead);
    if (byId("clearAllBtn")) byId("clearAllBtn").addEventListener("click", clearAll);
    if (byId("refreshBtn")) byId("refreshBtn").addEventListener("click", loadSubmissions);
    if (byId("exportBtn")) byId("exportBtn").addEventListener("click", exportCsv);
  }

  /* ============================================================
     Read a single message
     ============================================================ */
  function openMessage(id) {
    const s = submissions.find((x) => x.id === id);
    if (!s) return;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" style="max-width:640px;">
        <div class="modal-head">
          <h2>Message from ${Admin.escapeHtml(s.name)}</h2>
          <button class="modal-close" id="closeModal" aria-label="Close">&times;</button>
        </div>

        <div class="msg-meta">
          <div><span class="msg-meta-label">Email</span><a href="mailto:${Admin.escapeHtml(s.email)}" class="msg-meta-value">${Admin.escapeHtml(s.email)}</a></div>
          <div><span class="msg-meta-label">Inquiry type</span><span class="msg-meta-value">${Admin.escapeHtml(TYPE_LABELS[s.inquiry_type] || s.inquiry_type || "General")}</span></div>
          <div><span class="msg-meta-label">Received</span><span class="msg-meta-value">${Admin.escapeHtml(new Date(s.created_at).toLocaleString())}</span></div>
          ${s.preferred_date ? `<div><span class="msg-meta-label">Requested date</span><span class="msg-meta-value">${Admin.escapeHtml(s.preferred_date)}</span></div>` : ""}
        </div>

        <div class="msg-body">${Admin.escapeHtml(s.message).replace(/\n/g, "<br>")}</div>

        <div class="form-field" style="margin-top:18px;">
          <label for="adminNotes">Private notes <span class="hint">only ever visible here in the admin panel</span></label>
          <textarea id="adminNotes" rows="3" placeholder="e.g. Replied 3 Aug — sent rate card">${Admin.escapeHtml(s.admin_notes || "")}</textarea>
        </div>

        <div class="modal-foot" style="justify-content:space-between;">
          <button type="button" class="btn btn-danger btn-sm" id="modalDelete">Delete</button>
          <div class="row-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="modalToggleRead">${s.is_read ? "Mark as unread" : "Mark as read"}</button>
            <button type="button" class="btn btn-ghost btn-sm" id="modalSaveNotes">Save notes</button>
            <a class="btn btn-primary btn-sm" id="modalReply" href="mailto:${Admin.escapeHtml(s.email)}?subject=${encodeURIComponent("Re: your message to Shahedin")}">Reply by email</a>
          </div>
        </div>
      </div>`;

    document.body.appendChild(backdrop);

    function close() {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    backdrop.querySelector("#closeModal").addEventListener("click", close);

    backdrop.querySelector("#modalSaveNotes").addEventListener("click", async () => {
      const notes = backdrop.querySelector("#adminNotes").value;
      const { error } = await c.from("contact_submissions").update({ admin_notes: notes }).eq("id", s.id);
      if (error) return Admin.toast("Couldn't save notes: " + error.message, true);
      s.admin_notes = notes;
      Admin.toast("Notes saved.");
    });

    backdrop.querySelector("#modalToggleRead").addEventListener("click", async () => {
      await setRead(s.id, !s.is_read);
      close();
    });

    backdrop.querySelector("#modalDelete").addEventListener("click", async () => {
      const ok = await deleteOne(s.id);
      if (ok) close();
    });

    // Opening a message marks it read.
    if (!s.is_read) setRead(s.id, true, true);
  }

  /* ============================================================
     Single-row actions
     ============================================================ */
  async function setRead(id, isRead, quiet) {
    const { error } = await c.from("contact_submissions").update({ is_read: isRead }).eq("id", id);
    if (error) {
      Admin.toast("Couldn't update: " + error.message, true);
      return;
    }
    const s = submissions.find((x) => x.id === id);
    if (s) s.is_read = isRead;
    render();
    if (!quiet) Admin.toast(isRead ? "Marked as read." : "Marked as unread.");
  }

  async function toggleStar(id) {
    const s = submissions.find((x) => x.id === id);
    if (!s) return;
    const next = !s.is_starred;
    const { error } = await c.from("contact_submissions").update({ is_starred: next }).eq("id", id);
    if (error) return Admin.toast("Couldn't update: " + error.message, true);
    s.is_starred = next;
    render();
  }

  async function deleteOne(id) {
    const s = submissions.find((x) => x.id === id);
    const who = s ? s.name : "this message";
    if (!confirm(`Delete the message from ${who}? This cannot be undone.`)) return false;

    const { error } = await c.from("contact_submissions").delete().eq("id", id);
    if (error) {
      Admin.toast("Couldn't delete: " + error.message, true);
      return false;
    }
    submissions = submissions.filter((x) => x.id !== id);
    selected.delete(id);
    render();
    Admin.toast("Message deleted.");
    return true;
  }

  /* ============================================================
     Bulk actions
     ============================================================ */
  async function markSelectedRead() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const { error } = await c.from("contact_submissions").update({ is_read: true }).in("id", ids);
    if (error) return Admin.toast("Couldn't update: " + error.message, true);
    submissions.forEach((s) => {
      if (selected.has(s.id)) s.is_read = true;
    });
    selected.clear();
    render();
    Admin.toast(`${ids.length} message${ids.length === 1 ? "" : "s"} marked as read.`);
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected message${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;

    const { error } = await c.from("contact_submissions").delete().in("id", ids);
    if (error) return Admin.toast("Couldn't delete: " + error.message, true);

    submissions = submissions.filter((s) => !selected.has(s.id));
    selected.clear();
    render();
    Admin.toast(`${ids.length} message${ids.length === 1 ? "" : "s"} deleted.`);
  }

  async function deleteAllRead() {
    const ids = submissions.filter((s) => s.is_read).map((s) => s.id);
    if (!ids.length) return;
    if (!confirm(`Delete all ${ids.length} read message${ids.length === 1 ? "" : "s"}? Unread messages are kept. This cannot be undone.`)) return;

    const { error } = await c.from("contact_submissions").delete().in("id", ids);
    if (error) return Admin.toast("Couldn't delete: " + error.message, true);

    submissions = submissions.filter((s) => !s.is_read);
    selected.clear();
    render();
    Admin.toast(`${ids.length} read message${ids.length === 1 ? "" : "s"} deleted.`);
  }

  async function clearAll() {
    const total = submissions.length;
    if (!total) return;

    // Two-step confirmation, because this one can't be undone.
    if (!confirm(`This will permanently delete ALL ${total} contact messages.\n\nExport a CSV first if you want a copy. Continue?`)) return;
    const typed = prompt(`To confirm, type DELETE below.\n\nAll ${total} messages will be erased permanently.`);
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== "DELETE") {
      Admin.toast("Cancelled — nothing was deleted.");
      return;
    }

    const ids = submissions.map((s) => s.id);
    const { error } = await c.from("contact_submissions").delete().in("id", ids);
    if (error) return Admin.toast("Couldn't clear messages: " + error.message, true);

    submissions = [];
    selected.clear();
    render();
    Admin.toast(`All ${total} messages cleared.`);
  }

  /* ============================================================
     CSV export
     ============================================================ */
  function exportCsv() {
    const headers = ["Received", "Name", "Email", "Inquiry type", "Message", "Requested date", "Read", "Starred", "Admin notes"];
    const escapeCell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;

    const lines = [headers.map(escapeCell).join(",")];
    submissions.forEach((s) => {
      lines.push(
        [
          new Date(s.created_at).toLocaleString(),
          s.name,
          s.email,
          TYPE_LABELS[s.inquiry_type] || s.inquiry_type || "General",
          s.message,
          s.preferred_date || "",
          s.is_read ? "yes" : "no",
          s.is_starred ? "yes" : "no",
          s.admin_notes || "",
        ]
          .map(escapeCell)
          .join(",")
      );
    });

    // BOM so Excel opens the Bangla text correctly.
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contact-messages-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    Admin.toast("CSV downloaded.");
  }
})();
