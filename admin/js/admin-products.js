(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell("products.html", "Store Products", "Add, edit, unpublish, or remove products. Changes appear on the live site right away.", admin);
  const content = document.getElementById("adminContent");
  const c = Admin.client();
  let products = [];
  let editingId = null;

  const CATEGORY_SUGGESTIONS = ["books", "notes", "merch", "digital", "physical"];

  content.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>All products</h2>
          <p>"Stock" only matters for physical items — leave it blank for unlimited digital goods.</p>
        </div>
        <button class="btn btn-primary" id="addProductBtn">+ Add product</button>
      </div>
      <div id="productTableWrap"><div class="loading-row"><div class="spinner"></div> Loading products…</div></div>
    </div>`;

  document.getElementById("addProductBtn").addEventListener("click", () => openModal(null));

  await loadProducts();
  if (new URLSearchParams(location.search).get("new")) openModal(null);

  async function loadProducts() {
    const { data, error } = await c.from("products").select("*").order("sort_order", { ascending: true });
    if (error) { Admin.toast("Couldn't load products: " + error.message, true); return; }
    products = data || [];
    renderTable();
  }

  function renderTable() {
    const wrap = document.getElementById("productTableWrap");
    if (!products.length) {
      wrap.innerHTML = `<div class="empty-state">No products yet. Click "+ Add product" to create your first one.</div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Product</th><th>Type</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${products.map((p) => `
            <tr>
              <td>
                <div class="row-title-cell">
                  <div class="row-thumb" style="${p.image_url ? `background-image:url('${p.image_url}')` : ""}"></div>
                  <div>
                    <div class="row-title">${Admin.escapeHtml(p.name_en || p.name_bn)}</div>
                    <div class="row-sub">${Admin.escapeHtml(p.category)} · /${Admin.escapeHtml(p.slug)}</div>
                  </div>
                </div>
              </td>
              <td style="text-transform:capitalize;">${Admin.escapeHtml(p.type)}</td>
              <td>${p.old_price_bdt ? `<span style="text-decoration:line-through;color:var(--text-faint);">৳${p.old_price_bdt}</span> ` : ""}৳${p.price_bdt}</td>
              <td>${p.stock === null || p.stock === undefined ? "∞" : p.stock}</td>
              <td>${p.is_published ? '<span class="badge badge-live">Live</span>' : '<span class="badge badge-draft">Draft</span>'}</td>
              <td>
                <div class="row-actions">
                  <button class="icon-btn edit-btn" data-id="${p.id}" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
                  <button class="icon-btn del-btn" data-id="${p.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg></button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`;

    wrap.querySelectorAll(".edit-btn").forEach((b) => b.addEventListener("click", () => openModal(b.dataset.id)));
    wrap.querySelectorAll(".del-btn").forEach((b) => b.addEventListener("click", () => deleteProduct(b.dataset.id)));
  }

  async function deleteProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!confirm(`Delete "${p.name_en || p.name_bn}"? This can't be undone.`)) return;
    const { error } = await c.from("products").delete().eq("id", id);
    if (error) { Admin.toast("Couldn't delete: " + error.message, true); return; }
    Admin.toast("Product deleted.");
    await loadProducts();
  }

  function openModal(id) {
    editingId = id;
    const p = id ? products.find((x) => x.id === id) : null;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "productModal";
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <h2>${p ? "Edit product" : "Add a new product"}</h2>
          <button class="modal-close" id="closeModal">&times;</button>
        </div>
        <form id="productForm">
          <div class="form-grid">
            <div class="form-field">
              <label>Name (English)</label>
              <input type="text" id="f_name_en" value="${Admin.escapeHtml(p?.name_en || "")}" required>
            </div>
            <div class="form-field">
              <label>Name (Bangla) <span class="hint">optional</span></label>
              <input type="text" id="f_name_bn" value="${Admin.escapeHtml(p?.name_bn || "")}">
            </div>
            <div class="form-field full">
              <label>Link on the site <span class="hint">auto-filled — only change if you know what it does</span></label>
              <input type="text" id="f_slug" value="${Admin.escapeHtml(p?.slug || "")}" required>
            </div>
            <div class="form-field full">
              <label>Description (English)</label>
              <textarea id="f_desc_en">${Admin.escapeHtml(p?.description_en || "")}</textarea>
            </div>
            <div class="form-field">
              <label>Category <span class="hint">used for the filter tabs on the Store page</span></label>
              <input type="text" id="f_category" list="categoryList" value="${Admin.escapeHtml(p?.category || "digital")}">
              <datalist id="categoryList">${CATEGORY_SUGGESTIONS.map((x) => `<option value="${x}">`).join("")}</datalist>
            </div>
            <div class="form-field">
              <label>Type</label>
              <select id="f_type">
                <option value="digital" ${p?.type !== "physical" ? "selected" : ""}>Digital download</option>
                <option value="physical" ${p?.type === "physical" ? "selected" : ""}>Physical (shipped)</option>
              </select>
            </div>
            <div class="form-field">
              <label>Price (৳ BDT)</label>
              <input type="number" id="f_price" min="0" value="${p?.price_bdt ?? 0}">
            </div>
            <div class="form-field">
              <label>Original price <span class="hint">optional — set to show a "Sale" badge</span></label>
              <input type="number" id="f_old_price" min="0" value="${p?.old_price_bdt ?? ""}">
            </div>
            <div class="form-field">
              <label>Stock <span class="hint">leave blank = unlimited</span></label>
              <input type="number" id="f_stock" min="0" value="${p?.stock ?? ""}">
            </div>
            <div class="form-field">
              <label>Order on the site</label>
              <input type="number" id="f_sort" value="${p?.sort_order ?? 0}">
            </div>
            <div class="form-field full">
              <label>Thumbnail color</label>
              <div class="tone-picker" id="tonePicker">
                ${[1,2,3,4,5,6].map((t) => `<button type="button" class="tone-${t} ${(p?.tone || 1) === t ? "selected" : ""}" data-tone="${t}"></button>`).join("")}
              </div>
            </div>
            <div class="form-field full">
              <label>Product image <span class="hint">optional — replaces the color above</span></label>
              <input type="file" id="f_image" accept="image/*">
              ${p?.image_url ? `<div class="hint">Current: <a href="${p.image_url}" target="_blank">view image</a></div>` : ""}
            </div>
            <div class="form-field">
              <label>&nbsp;</label>
              <label class="form-check"><input type="checkbox" id="f_published" ${p === null || p?.is_published ? "checked" : ""}> Published (visible on site)</label>
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" id="cancelModal">Cancel</button>
            <button type="submit" class="btn btn-primary" id="saveProductBtn">${p ? "Save changes" : "Create product"}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    document.getElementById("closeModal").addEventListener("click", closeModal);
    document.getElementById("cancelModal").addEventListener("click", closeModal);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });

    document.getElementById("f_name_en").addEventListener("input", (e) => {
      if (!p) document.getElementById("f_slug").value = Admin.slugify(e.target.value);
    });

    document.getElementById("tonePicker").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      backdrop.querySelectorAll(".tone-picker button").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });

    document.getElementById("productForm").addEventListener("submit", saveProduct);
  }

  function closeModal() {
    const el = document.getElementById("productModal");
    if (el) el.remove();
  }

  async function saveProduct(e) {
    e.preventDefault();
    const btn = document.getElementById("saveProductBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      let image_url = editingId ? products.find((x) => x.id === editingId)?.image_url || null : null;
      const fileInput = document.getElementById("f_image");
      if (fileInput.files[0]) {
        image_url = await Admin.uploadImage(fileInput.files[0], "products");
      }

      const selectedTone = document.querySelector("#tonePicker button.selected");
      const stockVal = document.getElementById("f_stock").value;
      const oldPriceVal = document.getElementById("f_old_price").value;

      const payload = {
        name_en: document.getElementById("f_name_en").value.trim(),
        name_bn: document.getElementById("f_name_bn").value.trim() || null,
        slug: Admin.slugify(document.getElementById("f_slug").value),
        description_en: document.getElementById("f_desc_en").value.trim(),
        category: document.getElementById("f_category").value.trim() || "digital",
        type: document.getElementById("f_type").value,
        price_bdt: parseInt(document.getElementById("f_price").value || "0", 10),
        old_price_bdt: oldPriceVal ? parseInt(oldPriceVal, 10) : null,
        stock: stockVal === "" ? null : parseInt(stockVal, 10),
        tone: selectedTone ? parseInt(selectedTone.dataset.tone, 10) : 1,
        image_url,
        sort_order: parseInt(document.getElementById("f_sort").value || "0", 10),
        is_published: document.getElementById("f_published").checked,
      };

      let res;
      if (editingId) {
        res = await c.from("products").update(payload).eq("id", editingId);
      } else {
        res = await c.from("products").insert(payload);
      }
      if (res.error) throw res.error;

      Admin.toast(editingId ? "Product updated." : "Product created.");
      closeModal();
      await loadProducts();
    } catch (err) {
      Admin.toast("Couldn't save: " + (err.message || err), true);
      btn.disabled = false;
      btn.textContent = editingId ? "Save changes" : "Create product";
    }
  }
})();
