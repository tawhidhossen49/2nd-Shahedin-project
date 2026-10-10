/* =========================================================
   admin-team.js — Team & access
   ---------------------------------------------------------
   Main admins only. This is where the other admins are added,
   removed, made main or limited, and given the pages they may
   use.

   Nothing here writes to the `admins` table directly, and it
   could not if it tried: the table has no insert, update or
   delete policy. Every change goes through a function that
   checks the caller is a main admin and keeps at least one
   main admin in place (schema.sql section 34):

     admin_set_access     role, pages and name of an admin
     admin_remove         take admin access away
     admin_add_existing   make an existing login an admin
     admin-users (Edge)   create a brand-new login, then add it
   ========================================================= */
(async function () {
  "use strict";
  const me = await Admin.requireAdmin();
  if (!me) return;

  Admin.renderShell("team.html", "Team & access", "Choose who can log in to this panel, and which pages each person can use.", me);
  const content = document.getElementById("adminContent");
  const c = Admin.client();
  const esc = Admin.escapeHtml;
  const PAGES = Admin.PAGES;
  let team = [];

  /* A database that has not run section 34 has no roles to manage. Say so
     in plain words rather than show a table that cannot be saved. */
  if (me.legacy) {
    content.innerHTML = `<div class="notice">
      <strong>One step is still needed before this page can be used.</strong><br><br>
      Roles are stored in the database, and the database has not been updated for them yet.
      Ask your developer to run the latest <code>schema.sql</code> (section 34) in the Supabase SQL editor,
      then reload this page. Until then every admin keeps full access, exactly as before.
    </div>`;
    return;
  }

  content.innerHTML = `
    <div class="help-card">
      <h2>How access works</h2>
      <div class="help-grid">
        <div>
          <span class="badge badge-main">Main admin</span>
          <p>Can open <strong>every page</strong>, and can add, remove and change other team members on this page. Give this only to people you fully trust.</p>
        </div>
        <div>
          <span class="badge badge-limited">Limited access</span>
          <p>Can open <strong>only the pages you tick</strong> for them. Everything else is hidden from them and locked.</p>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Team members</h2>
          <p>Everyone who can log in to this admin panel.</p>
        </div>
        <button class="btn btn-primary" id="addMemberBtn">+ Add a team member</button>
      </div>
      <div id="teamTableWrap"><div class="loading-row"><div class="spinner"></div> Loading team…</div></div>
    </div>`;

  // Declared before the first await below: loadTeam() renders the table,
  // and the table needs both.
  const displayName = (m) => m.full_name || (m.email || "").split("@")[0] || "(no name)";
  const mainCount = () => team.filter((m) => m.role === "main").length;

  document.getElementById("addMemberBtn").addEventListener("click", () => openModal(null));
  await loadTeam();

  async function loadTeam() {
    const { data, error } = await c.from("admins").select("id,email,full_name,role,permissions,created_at").order("created_at", { ascending: true });
    if (error) { Admin.toast("Couldn't load the team: " + error.message, true); return; }
    team = data || [];
    renderTable();
  }

  function accessSummary(m) {
    if (m.role === "main") return `<span class="row-sub">Every page</span>`;
    const allowed = PAGES.filter((p) => (m.permissions || []).includes(p.key));
    if (!allowed.length) return `<span class="row-sub">No pages yet — they can only see the dashboard</span>`;
    if (allowed.length === PAGES.length) return `<span class="row-sub">Every page, but cannot manage the team</span>`;
    return `<div class="access-chips">${allowed.map((p) => `<span class="access-chip">${esc(p.label)}</span>`).join("")}</div>`;
  }

  function renderTable() {
    const wrap = document.getElementById("teamTableWrap");
    wrap.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Person</th><th>Role</th><th>Can use</th><th></th></tr></thead>
        <tbody>
          ${team.map((m) => {
            const isMe = m.id === me.id;
            return `
            <tr>
              <td>
                <div class="row-title">${esc(displayName(m))}${isMe ? ` <span class="row-sub">(you)</span>` : ""}</div>
                <div class="row-sub">${esc(m.email || "")}</div>
              </td>
              <td>${m.role === "main" ? '<span class="badge badge-main">Main admin</span>' : '<span class="badge badge-limited">Limited access</span>'}</td>
              <td>${accessSummary(m)}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(m.id)}">Change access</button>
                  ${isMe ? "" : `<button type="button" class="btn btn-danger btn-sm" data-remove="${esc(m.id)}">Remove</button>`}
                </div>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;

    wrap.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openModal(b.dataset.edit)));
    wrap.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => removeMember(b.dataset.remove, b)));
  }

  /* Postgres raises these with a sentence written for the person reading it
     (see the functions in schema.sql), so the message is shown as it is. */
  function rpcMessage(error, fallback) {
    return (error && (error.message || error.details)) || fallback;
  }

  async function removeMember(id, btn) {
    const m = team.find((x) => x.id === id);
    if (!m) return;
    if (m.role === "main" && mainCount() <= 1) {
      Admin.toast("This is the only main admin. Make someone else a main admin first.", true);
      return;
    }
    if (!confirm(`Remove ${displayName(m)} (${m.email}) from the admin panel?\n\nThey will no longer be able to log in here. Nothing they added is deleted, and you can add them again later.`)) return;

    btn.disabled = true;
    const { error } = await c.rpc("admin_remove", { p_admin_id: id });
    btn.disabled = false;
    if (error) { Admin.toast(rpcMessage(error, "Couldn't remove that person."), true); return; }
    Admin.toast(`${displayName(m)} no longer has admin access.`);
    await loadTeam();
  }

  function openModal(id) {
    const m = id ? team.find((x) => x.id === id) : null;
    const isMe = !!m && m.id === me.id;
    const role = m ? m.role : "partial";
    const allowed = new Set(m ? m.permissions || [] : []);
    // The one main admin cannot be made limited: someone has to be able to
    // open this page. The database refuses it too; this just says why first.
    const lastMain = !!m && m.role === "main" && mainCount() <= 1;
    const roleLocked = isMe || lastMain;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "teamModal";
    backdrop.innerHTML = `
      <div class="modal" style="max-width:680px;">
        <div class="modal-head">
          <h2>${m ? `Change access for ${esc(displayName(m))}` : "Add a team member"}</h2>
          <button class="modal-close" id="closeModal" aria-label="Close">&times;</button>
        </div>
        <form id="teamForm" novalidate>
          <div class="form-section">
            <h3 class="form-section-title"><span class="step-num">1</span> Who is it?</h3>
            <div class="form-grid">
              <div class="form-field">
                <label for="t_email">Email <span class="req">mandatory</span></label>
                <input type="email" id="t_email" autocomplete="off" placeholder="name@example.com" value="${esc(m?.email || "")}" ${m ? "readonly" : ""}>
                <span class="hint">${m ? "The email cannot be changed. To use a different one, remove this person and add them again." : "They will log in to the admin panel with this email."}</span>
              </div>
              <div class="form-field">
                <label for="t_name">Name</label>
                <input type="text" id="t_name" autocomplete="off" placeholder="e.g. Tawhid Hossen" value="${esc(m?.full_name || "")}">
                <span class="hint">Shown in this list so you know who is who.</span>
              </div>
              ${m ? "" : `
              <div class="form-field full">
                <label for="t_password">Password for them <span class="req">mandatory</span></label>
                <div class="password-row">
                  <input type="password" id="t_password" autocomplete="new-password" placeholder="At least 8 characters">
                  <button type="button" class="btn btn-ghost btn-sm" id="togglePassword">Show</button>
                </div>
                <span class="hint">Choose a password and tell it to them yourself — nothing is emailed. If this email already has a login on the site, that login keeps its own password and this one is ignored.</span>
              </div>`}
            </div>
          </div>

          <div class="form-section">
            <h3 class="form-section-title"><span class="step-num">2</span> What kind of access?</h3>
            <div class="choice-cards" role="radiogroup" aria-label="Role">
              <label class="choice-card">
                <input type="radio" name="t_role" value="partial" ${role === "partial" ? "checked" : ""} ${roleLocked ? "disabled" : ""}>
                <span><b>Limited access</b><span class="hint">Only the pages you tick below. Best for helpers and staff.</span></span>
              </label>
              <label class="choice-card">
                <input type="radio" name="t_role" value="main" ${role === "main" ? "checked" : ""} ${roleLocked ? "disabled" : ""}>
                <span><b>Main admin</b><span class="hint">Every page, and can add or remove team members — including you.</span></span>
              </label>
            </div>
            ${isMe ? `<p class="hint" style="margin-top:10px;">You cannot change your own role. Another main admin has to do it.</p>`
              : lastMain ? `<p class="hint" style="margin-top:10px;">This is the only main admin, so the role cannot be changed. Make someone else a main admin first.</p>` : ""}
          </div>

          <div class="form-section" id="pagesSection">
            <h3 class="form-section-title"><span class="step-num">3</span> Which pages can they use?</h3>
            <div class="pages-toolbar">
              <span class="hint">The Dashboard is always visible. Tick everything else they need.</span>
              <span>
                <button type="button" class="btn btn-ghost btn-sm" id="tickAll">Tick all</button>
                <button type="button" class="btn btn-ghost btn-sm" id="tickNone">Clear</button>
              </span>
            </div>
            <div class="flag-checks page-checks">
              ${PAGES.map((p) => `
                <label class="form-check">
                  <input type="checkbox" class="t-page" value="${p.key}" ${allowed.has(p.key) ? "checked" : ""}>
                  <span><b>${esc(p.label)}</b><span class="hint">${esc(p.desc)}</span></span>
                </label>`).join("")}
            </div>
          </div>
          <p class="hint" id="mainNote" hidden>A main admin can open every page, so there is nothing to tick.</p>

          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" id="cancelModal">Cancel</button>
            <button type="submit" class="btn btn-primary" id="saveTeamBtn">${m ? "Save changes" : "Add team member"}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    document.getElementById("closeModal").addEventListener("click", close);
    document.getElementById("cancelModal").addEventListener("click", close);

    const selectedRole = () => (backdrop.querySelector('input[name="t_role"]:checked') || {}).value || role;
    function syncRole() {
      const isMainRole = selectedRole() === "main";
      document.getElementById("pagesSection").hidden = isMainRole;
      document.getElementById("mainNote").hidden = !isMainRole;
    }
    backdrop.querySelectorAll('input[name="t_role"]').forEach((r) => r.addEventListener("change", syncRole));
    syncRole();

    document.getElementById("tickAll").addEventListener("click", () => backdrop.querySelectorAll(".t-page").forEach((x) => { x.checked = true; }));
    document.getElementById("tickNone").addEventListener("click", () => backdrop.querySelectorAll(".t-page").forEach((x) => { x.checked = false; }));

    const toggle = document.getElementById("togglePassword");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const input = document.getElementById("t_password");
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        toggle.textContent = show ? "Hide" : "Show";
      });
    }

    document.getElementById("teamForm").addEventListener("submit", (e) => {
      e.preventDefault();
      save(m, selectedRole(), close);
    });
  }

  async function save(existing, role, close) {
    const btn = document.getElementById("saveTeamBtn");
    const form = document.getElementById("teamForm");
    const rules = existing ? [] : [
      {
        id: "t_email", label: "Email",
        message: "Enter their email address, like name@example.com.",
        test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
      },
      {
        id: "t_password", label: "Password",
        message: "The password must be at least 8 characters.",
        test: (v) => v.length >= 8,
      },
    ];
    const missing = Admin.validateFields(form, rules);
    if (missing.length) { Admin.toast(Admin.missingSummary(missing), true); return; }

    const name = document.getElementById("t_name").value.trim();
    const permissions = role === "main" ? [] : Array.from(form.querySelectorAll(".t-page:checked")).map((x) => x.value);

    if (role === "partial" && !permissions.length &&
        !confirm("You have not ticked any page.\n\nThis person will be able to log in but will only see the dashboard. Save anyway?")) return;
    if (role === "main" && (!existing || existing.role !== "main") &&
        !confirm("Make this person a MAIN admin?\n\nThey will be able to open every page, and add or remove team members — including you.")) return;

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving…";
    const done = () => { btn.disabled = false; btn.textContent = original; };

    try {
      if (existing) {
        const { error } = await c.rpc("admin_set_access", {
          p_admin_id: existing.id, p_role: role, p_permissions: permissions, p_full_name: name || null,
        });
        if (error) throw new Error(rpcMessage(error, "Couldn't save the changes."));
        Admin.toast("Access updated. It applies the next time they open a page.");
      } else {
        const email = document.getElementById("t_email").value.trim().toLowerCase();
        const password = document.getElementById("t_password").value;
        const added = await addMember({ email, password, name, role, permissions });
        if (!added) { done(); return; }
      }
      close();
      await loadTeam();
    } catch (err) {
      console.error("Shahedin admin: team save failed.", err);
      Admin.toast(err.message || "Couldn't save. Please try again.", true);
      done();
    }
  }

  /* A new person is one of two cases, and the admin should not have to know
     which. Try to create a login. If the email already has one, ask before
     turning that existing login into an admin -- its password is theirs and
     is left alone. Returns true when someone was added. */
  async function addMember({ email, password, name, role, permissions }) {
    const { data, error } = await c.functions.invoke("admin-users", {
      body: { email, password, full_name: name, role, permissions },
    });

    if (!error) {
      Admin.toast(`${name || email} was added. Tell them the password you chose.`);
      return !!data;
    }

    let status = 0;
    let body = null;
    try {
      status = error.context && error.context.status;
      body = await error.context.json();
    } catch (parseErr) {
      body = null;
    }

    if (body && body.code === "exists") {
      if (!confirm(`${email} already has a login on the site.\n\nGive that login admin access? Their existing password stays the same — the one you typed here is not used.`)) return false;
      const res = await c.rpc("admin_add_existing", {
        p_email: email, p_full_name: name || null, p_role: role, p_permissions: permissions,
      });
      if (res.error) throw new Error(rpcMessage(res.error, "Couldn't add that person."));
      Admin.toast(`${name || email} was added. They log in with the password they already have.`);
      return true;
    }

    if (body && body.error) throw new Error(body.error);
    /* No readable reply means the function itself is not there: it has not
       been deployed yet. That is a set-up step, not something the admin did
       wrong, so say exactly that. */
    if (status === 404 || !status) {
      throw new Error("Adding a new login is not switched on yet. Ask your developer to deploy the “admin-users” function (see ADMIN_SETUP.md), then try again.");
    }
    throw new Error("Couldn't add that person. Please try again.");
  }
})();
