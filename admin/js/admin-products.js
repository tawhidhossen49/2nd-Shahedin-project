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
                    <div class="row-title">${Admin.escapeHtml(p.name_bn || p.name_en)}</div>
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
                  <button class="icon-btn edit-btn" data-id="${p.id}" title="Edit"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
                  <button class="icon-btn del-btn" data-id="${p.id}" title="Delete"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg></button>
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
    if (!confirm(`Delete "${p.name_bn || p.name_en}"? This can't be undone.`)) return;
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
        <!-- novalidate: the browser's own "Please fill out this field" bubble
             would fire before the submit handler and preempt the specific,
             per-field messages below. All required checks run in saveProduct. -->
        <form id="productForm" novalidate>
          <div class="form-grid">
            <div class="form-field">
              <label>Name (Bangla) <span class="req">mandatory</span> <span class="hint">· shown on the site</span></label>
              <input type="text" id="f_name_bn" value="${Admin.escapeHtml(p?.name_bn || "")}">
            </div>
            <div class="form-field">
              <label>Name (English) <span class="req">mandatory</span></label>
              <input type="text" id="f_name_en" value="${Admin.escapeHtml(p?.name_en || "")}">
            </div>
            <div class="form-field full">
              <label>Link on the site <span class="req">mandatory</span> <span class="hint">· auto-filled — only change if you know what it does</span></label>
              <input type="text" id="f_slug" value="${Admin.escapeHtml(p?.slug || "")}">
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

            <!-- Digital delivery. Hidden entirely for a physical product,
                 because a shipped item has nothing to download. What goes in
                 here is what the buyer gets in their dashboard the moment the
                 order completes. -->
            <div class="form-field full" id="deliveryBlock" style="border-top:1px solid var(--line); padding-top:16px; margin-top:4px;">
              <label for="f_delivery_type">What the buyer receives
                <span class="hint">delivered instantly in their dashboard after purchase</span>
              </label>
              <select id="f_delivery_type">
                <option value="none"  ${(p?.delivery_type || "none") === "none" ? "selected" : ""}>Nothing automatic (you send it yourself)</option>
                <option value="file"  ${p?.delivery_type === "file" ? "selected" : ""}>Upload a file (PDF, image, zip)</option>
                <option value="link"  ${p?.delivery_type === "link" ? "selected" : ""}>An external link (Drive, Notion, private video)</option>
              </select>
            </div>

            <div class="form-field full" data-delivery-field="file">
              <label for="f_delivery_file">Product file
                ${p?.delivery_url && p?.delivery_type === "file"
                  ? `<span class="hint">a file is already uploaded — choose a new one only to replace it</span>`
                  : ""}
              </label>
              <input type="file" id="f_delivery_file" accept=".pdf,.zip,.epub,image/*,application/pdf,application/zip">
              ${p?.delivery_url && p?.delivery_type === "file"
                ? `<p class="hint" style="margin-top:8px;">Currently: <a href="${Admin.escapeHtml(p.delivery_url)}" target="_blank" rel="noopener">open the uploaded file</a></p>`
                : ""}
            </div>

            <div class="form-field full" data-delivery-field="link">
              <label for="f_delivery_link">Link <span class="hint">make sure it is set to "anyone with the link can view"</span></label>
              <input type="url" id="f_delivery_link" placeholder="https://..."
                     value="${Admin.escapeHtml(p?.delivery_type === "link" ? (p?.delivery_url || "") : "")}">
            </div>

            <div class="form-field" data-delivery-field="file link">
              <label for="f_delivery_label">Button text <span class="hint">optional</span></label>
              <input type="text" id="f_delivery_label" placeholder="PDF ডাউনলোড করুন"
                     value="${Admin.escapeHtml(p?.delivery_label || "")}">
            </div>

            <div class="form-field" data-delivery-field="file link">
              <label for="f_delivery_note">Note for the buyer <span class="hint">optional, shown only after purchase</span></label>
              <input type="text" id="f_delivery_note" placeholder="যেকোনো সমস্যায় আমাদের জানান।"
                     value="${Admin.escapeHtml(p?.delivery_note || "")}">
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

    // Auto-slug from whichever name is filled in, only while creating.
    // Prefers English for a cleaner URL, falls back to the Bangla name.
    function autoSlug() {
      if (p) return;
      document.getElementById("f_slug").value = Admin.slugifyOrFallback(
        "product",
        document.getElementById("f_name_en").value,
        document.getElementById("f_name_bn").value
      );
    }
    document.getElementById("f_name_en").addEventListener("input", autoSlug);
    document.getElementById("f_name_bn").addEventListener("input", autoSlug);

    /* Only show delivery options that apply. A physical product loses the
       whole block; picking "nothing automatic" hides the file/link inputs so
       the form never asks for something it will not use. */
    const typeEl = document.getElementById("f_type");
    const deliveryTypeEl = document.getElementById("f_delivery_type");
    function syncDelivery() {
      const isDigital = typeEl.value === "digital";
      const mode = isDigital ? deliveryTypeEl.value : "none";
      document.getElementById("deliveryBlock").hidden = !isDigital;
      backdrop.querySelectorAll("[data-delivery-field]").forEach((el) => {
        el.hidden = !isDigital || !el.dataset.deliveryField.split(" ").includes(mode);
      });
    }
    typeEl.addEventListener("change", syncDelivery);
    deliveryTypeEl.addEventListener("change", syncDelivery);
    syncDelivery();

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

  /* Each rule names exactly one field. "Bangla name is missing" can only ever
     appear because f_name_bn is blank — it is never used as a stand-in for
     some other failure. */
  const PRODUCT_RULES = [
    { id: "f_name_bn", label: "Bangla name", message: "Bangla name is missing. This is the name shown to visitors on the site." },
    { id: "f_name_en", label: "English name", message: "English name is missing." },
    { id: "f_slug", label: "Link on the site", message: "Link on the site is missing. It is normally filled in for you from the name." },
    {
      id: "f_price",
      label: "Price",
      message: "Price must be a number — use 0 for a free product.",
      test: (v) => v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0,
    },
    {
      id: "f_stock",
      label: "Stock",
      message: "Stock must be a whole number, or left blank for unlimited.",
      test: (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
    },
    {
      id: "f_old_price",
      label: "Original price",
      message: "Original price must be higher than the price, or left blank.",
      test: (v) => v === "" || Number(v) > Number(document.getElementById("f_price").value || 0),
    },
  ];

  async function saveProduct(e) {
    e.preventDefault();

    // Validate BEFORE touching the button or uploading anything — the old
    // order uploaded the image first, so a rejected save left an orphan file
    // in storage every time.
    const missing = Admin.validateFields(document.getElementById("productForm"), PRODUCT_RULES);
    if (missing.length) {
      Admin.toast(Admin.missingSummary(missing), true);
      return;
    }

    /* Delivery is validated separately because whether it is required depends
       on two other fields. Saving "file" with no file, or "link" with no URL,
       would leave buyers paying for a product that delivers nothing. */
    const existing = editingId ? products.find((x) => x.id === editingId) : null;
    const isDigital = document.getElementById("f_type").value === "digital";
    const deliveryType = isDigital ? document.getElementById("f_delivery_type").value : "none";
    const linkVal = document.getElementById("f_delivery_link").value.trim();
    const newFile = document.getElementById("f_delivery_file").files[0];
    const keptFile = existing && existing.delivery_type === "file" ? existing.delivery_url : null;

    if (deliveryType === "file" && !newFile && !keptFile) {
      Admin.showFieldError(document.getElementById("f_delivery_file"), "Choose the file buyers will download, or set delivery to “Nothing automatic”.");
      Admin.toast("Product file is missing.", true);
      return;
    }
    if (deliveryType === "link" && !/^https?:\/\/\S+$/i.test(linkVal)) {
      Admin.showFieldError(document.getElementById("f_delivery_link"), "Enter the full link, starting with https://");
      Admin.toast("Delivery link is missing or incomplete.", true);
      return;
    }

    const btn = document.getElementById("saveProductBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      let image_url = existing ? existing.image_url || null : null;
      const fileInput = document.getElementById("f_image");
      if (fileInput.files[0]) {
        image_url = await Admin.uploadImage(fileInput.files[0], "products");
      }

      // Uploaded to its own folder, and each upload gets a fresh timestamped
      // path, so replacing a file never serves a stale cached copy.
      let delivery_url = null;
      if (deliveryType === "file") {
        delivery_url = newFile ? await Admin.uploadFile(newFile, "product-files") : keptFile;
      } else if (deliveryType === "link") {
        delivery_url = linkVal;
      }

      const selectedTone = document.querySelector("#tonePicker button.selected");
      const stockVal = document.getElementById("f_stock").value;
      const oldPriceVal = document.getElementById("f_old_price").value;

      const payload = {
        // name_bn is NOT NULL in the database, so an empty box must never be
        // turned into an explicit null here — that was the save error.
        name_bn: document.getElementById("f_name_bn").value.trim(),
        name_en: document.getElementById("f_name_en").value.trim() || null,
        slug: Admin.slugifyOrFallback("product", document.getElementById("f_slug").value),
        description_en: document.getElementById("f_desc_en").value.trim(),
        category: document.getElementById("f_category").value.trim() || "digital",
        type: document.getElementById("f_type").value,
        delivery_type: deliveryType,
        delivery_url,
        delivery_label: deliveryType === "none" ? null : document.getElementById("f_delivery_label").value.trim() || null,
        delivery_note: deliveryType === "none" ? null : document.getElementById("f_delivery_note").value.trim() || null,
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
      /* Even a server rejection gets pinned to the field that caused it, so
         the admin never has to translate a Postgres error into a form box.
         23505 = unique violation (the slug is the only unique column here),
         23502 = not-null violation, which names its own column. */
      const byColumn = { name_bn: "f_name_bn", name_en: "f_name_en", slug: "f_slug", price_bdt: "f_price" };
      let handled = false;

      if (err.code === "23505") {
        Admin.showFieldError(document.getElementById("f_slug"), "Another product already uses this link. Change it to something unique.");
        Admin.toast("That link is already taken by another product.", true);
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
      if (!handled) Admin.toast("Couldn't save: " + (err.message || err), true);

      btn.disabled = false;
      btn.textContent = editingId ? "Save changes" : "Create product";
    }
  }
})();
