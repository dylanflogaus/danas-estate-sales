const TOKEN_KEY = "danas_admin_token";

function $(sel, root = document) {
  return root.querySelector(sel);
}

function setStatus(node, message, isError = false) {
  if (!node) {
    return;
  }
  node.textContent = message || "";
  node.classList.toggle("admin-status-error", Boolean(isError && message));
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...options.headers
  };
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.body != null && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...options, headers });
  const raw = await res.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg = data && typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

const MAX_ADMIN_IMAGE_CHARS = 600000;
/** Stay under D1 ~2 MB `image_urls_json` column (UTF-8 bytes of JSON array). */
const MAX_PRODUCT_IMAGE_JSON_BYTES = 1_750_000;
/** Must match server `MAX_GALLERY_IMAGES` in catalog-api.js */
const MAX_IMAGES_PER_PRODUCT = 20;

/** Target max length per compressed upload (~5 photos stay under DB JSON limit). */
const TARGET_COMPRESSED_DATA_URL_CHARS = 300000;

function formatCents(c) {
  return `$${(Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseImageUrlsState(raw) {
  try {
    const j = JSON.parse(raw || "[]");
    return Array.isArray(j) ? j.filter((u) => typeof u === "string" && u.trim()) : [];
  } catch {
    return [];
  }
}

function readFileAsDataUrlRaw(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Could not read a file."));
    r.readAsDataURL(file);
  });
}

function isSvgFile(file) {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name || "");
}

/**
 * Downscale and re-encode as JPEG so data URLs stay under the D1-safe limit.
 */
async function compressRasterImageWithCanvas(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Could not decode this image type in the browser.");
  }

  const ow = bitmap.width;
  const oh = bitmap.height;
  if (ow < 1 || oh < 1) {
    bitmap.close();
    throw new Error("Invalid image dimensions.");
  }

  function fitToMaxEdge(w, h, maxEdge) {
    if (w <= maxEdge && h <= maxEdge) {
      return [w, h];
    }
    if (w >= h) {
      return [maxEdge, Math.max(1, Math.round((h * maxEdge) / w))];
    }
    return [Math.max(1, Math.round((w * maxEdge) / h)), maxEdge];
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not prepare image canvas.");
  }

  let maxEdge = Math.min(2048, Math.max(ow, oh));
  try {
    for (;;) {
      const [tw, th] = fitToMaxEdge(ow, oh, maxEdge);
      canvas.width = tw;
      canvas.height = th;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, tw, th);
      ctx.drawImage(bitmap, 0, 0, tw, th);

      let quality = 0.88;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > TARGET_COMPRESSED_DATA_URL_CHARS && quality > 0.38) {
        quality -= 0.06;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      if (dataUrl.length <= MAX_ADMIN_IMAGE_CHARS) {
        return dataUrl;
      }
      if (maxEdge <= 400) {
        throw new Error("Could not shrink this image enough. Try another photo.");
      }
      maxEdge = Math.floor(maxEdge * 0.72);
    }
  } finally {
    bitmap.close();
  }
}

async function readSingleImageFileAsDataUrl(file) {
  if (isSvgFile(file)) {
    const raw = await readFileAsDataUrlRaw(file);
    if (raw.length > MAX_ADMIN_IMAGE_CHARS) {
      throw new Error("SVG is too large to save. Simplify it or use a PNG or JPG.");
    }
    return raw;
  }

  if (file.size <= 350_000) {
    const raw = await readFileAsDataUrlRaw(file);
    if (raw.length <= TARGET_COMPRESSED_DATA_URL_CHARS) {
      return raw;
    }
  }

  try {
    return await compressRasterImageWithCanvas(file);
  } catch (firstErr) {
    const raw = await readFileAsDataUrlRaw(file);
    if (raw.length <= MAX_ADMIN_IMAGE_CHARS) {
      return raw;
    }
    throw firstErr instanceof Error
      ? firstErr
      : new Error("Could not process this image. Try a smaller JPG or PNG.");
  }
}

const IMAGE_FILE_EXT =
  /^(jpe?g|png|gif|webp|bmp|svg|heic|heif|avif|tiff?)$/i;

function isLikelyImageFile(file) {
  if (!file || typeof file.name !== "string") {
    return false;
  }
  if (file.type && file.type.startsWith("image/")) {
    return true;
  }
  const m = /\.([^.]+)$/.exec(file.name.trim());
  const ext = m ? m[1] : "";
  return IMAGE_FILE_EXT.test(ext);
}

async function buildImageUrlsForSave(form) {
  const urls = [...parseImageUrlsState(form.elements.image_urls_state.value)];
  if (urls.length > MAX_IMAGES_PER_PRODUCT) {
    throw new Error(
      `This product can have at most ${MAX_IMAGES_PER_PRODUCT} images. Use "Clear all images" or remove some, then try again.`
    );
  }
  for (const u of urls) {
    if (u.length > MAX_ADMIN_IMAGE_CHARS) {
      throw new Error("An image is too large to save. Use a smaller file.");
    }
  }
  const jsonBytes = new TextEncoder().encode(JSON.stringify(urls)).byteLength;
  if (jsonBytes > MAX_PRODUCT_IMAGE_JSON_BYTES) {
    throw new Error(
      "All images together are too large for one save (database limit is about 1.8 MB per product). Remove a photo or two."
    );
  }
  return urls;
}

function updateImageSummary(form, summaryEl) {
  if (!summaryEl) {
    return;
  }
  const n = parseImageUrlsState(form.elements.image_urls_state.value).length;
  const hasSavedId = Boolean(String(form.elements.editingId?.value || "").trim());
  const parts = [];
  parts.push(n === 0 ? "No photos yet." : n === 1 ? "1 photo." : `${n} photos.`);
  if (!hasSavedId) {
    parts.push("Save the product once, then choose files to upload.");
  }
  summaryEl.textContent = parts.join(" ");
}

/** blob: URLs for the file picker; revoked when previews refresh or form closes. */
const productPreviewObjectUrls = [];

function revokeProductPreviewObjectUrls() {
  for (const u of productPreviewObjectUrls) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* ignore */
    }
  }
  productPreviewObjectUrls.length = 0;
}

function makeAdminPreviewTile(src, caption) {
  const figure = document.createElement("figure");
  figure.className = "admin-preview-tile";
  const cell = document.createElement("div");
  cell.className = "admin-preview-img-wrap";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => {
    img.remove();
    const err = document.createElement("p");
    err.className = "admin-preview-broken";
    err.textContent = "Preview failed";
    cell.appendChild(err);
  }, { once: true });
  cell.appendChild(img);
  const cap = document.createElement("figcaption");
  cap.className = "admin-preview-caption";
  cap.textContent = caption;
  figure.appendChild(cell);
  figure.appendChild(cap);
  return figure;
}

function renderProductImagePreviews(form, containerEl) {
  if (!containerEl) {
    return;
  }
  revokeProductPreviewObjectUrls();
  containerEl.replaceChildren();

  const savedUrls = parseImageUrlsState(form.elements.image_urls_state.value);
  savedUrls.forEach((url, i) => {
    containerEl.appendChild(makeAdminPreviewTile(url, `Photo ${i + 1}`));
  });
}

function defaultExtrasJson() {
  return JSON.stringify(
    [
      { label: "Parking & arrival", body: "" },
      { label: "Payment & packing", body: "" },
      { label: "House rules", body: "" }
    ],
    null,
    2
  );
}

function defaultTagsJson() {
  return JSON.stringify(["Tag"], null, 2);
}

function initAdmin() {
  const statusEl = $("[data-admin-status]");
  const loginPanel = $("[data-admin-login-panel]");
  const loginForm = $("[data-admin-login-form]");
  const dashboard = $("[data-admin-dashboard]");
  const logoutBtn = $("[data-admin-logout]");

  const tabButtons = document.querySelectorAll("[data-admin-tab]");
  const panels = document.querySelectorAll("[data-admin-panel]");

  const productsTbody = $("[data-admin-products-tbody]");
  const newProductBtn = $("[data-admin-new-product]");
  const productFormPanel = $("[data-admin-product-form-panel]");
  const productFormTitle = $("[data-admin-product-form-title]");
  const productForm = $("[data-admin-product-form]");
  const productCancel = $("[data-admin-product-cancel]");
  const productImageSummary = $("[data-admin-image-summary]");
  const clearProductImagesBtn = $("[data-admin-clear-images]");
  const productFormStatus = $("[data-admin-product-status]");
  const productImagePreviews = $("[data-admin-product-previews]");
  const productSubmitBtn = productForm?.querySelector('button[type="submit"]');

  /** Snapshot for edit mode — unsaved if current form differs. */
  let productEditBaseline = null;

  function getProductFormCompareState(form) {
    return {
      name: String(form.elements.name?.value || "").trim(),
      description: String(form.elements.description?.value || "").trim(),
      price_dollars: String(form.elements.price_dollars?.value || "").trim(),
      category_slug: String(form.elements.category_slug?.value || "").trim(),
      category_label: String(form.elements.category_label?.value || "").trim(),
      badge: String(form.elements.badge?.value || "").trim(),
      sort_order: String(form.elements.sort_order?.value ?? "0").trim(),
      is_active: Boolean(form.elements.is_active?.checked),
      image_urls_state: String(form.elements.image_urls_state?.value || "[]").trim()
    };
  }

  function productCompareStatesEqual(a, b) {
    if (!a || !b) {
      return false;
    }
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function updateProductSaveButton() {
    if (!productSubmitBtn) {
      return;
    }
    const editingId = productForm.elements.editingId.value.trim();
    if (!editingId) {
      productSubmitBtn.textContent = "Save";
      productSubmitBtn.classList.remove("admin-btn-unsaved");
      productSubmitBtn.removeAttribute("aria-label");
      return;
    }
    const current = getProductFormCompareState(productForm);
    const dirty = !productCompareStatesEqual(current, productEditBaseline);
    if (dirty) {
      productSubmitBtn.textContent = "Not saved — click to save";
      productSubmitBtn.classList.add("admin-btn-unsaved");
      productSubmitBtn.setAttribute("aria-label", "Save your changes. You have edits that are not saved yet.");
    } else {
      productSubmitBtn.textContent = "Save";
      productSubmitBtn.classList.remove("admin-btn-unsaved");
      productSubmitBtn.removeAttribute("aria-label");
    }
  }

  function setProductEditBaselineFromForm() {
    productEditBaseline = getProductFormCompareState(productForm);
    updateProductSaveButton();
  }

  /** Instant image actions save to the server; refresh baseline image state for dirty detection. */
  function syncProductEditBaselineImagesFromForm() {
    if (productEditBaseline) {
      productEditBaseline.image_urls_state = String(
        productForm.elements.image_urls_state?.value || "[]"
      ).trim();
    }
    updateProductSaveButton();
  }

  const eventsTbody = $("[data-admin-events-tbody]");
  const newEventBtn = $("[data-admin-new-event]");
  const eventFormPanel = $("[data-admin-event-form-panel]");
  const eventFormTitle = $("[data-admin-event-form-title]");
  const eventForm = $("[data-admin-event-form]");
  const eventCancel = $("[data-admin-event-cancel]");

  function showLogin() {
    sessionStorage.removeItem(TOKEN_KEY);
    loginPanel.hidden = false;
    dashboard.hidden = true;
  }

  function showDashboard() {
    loginPanel.hidden = true;
    dashboard.hidden = false;
  }

  function selectTab(name) {
    tabButtons.forEach((btn) => {
      const on = btn.dataset.adminTab === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.adminPanel !== name;
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => selectTab(btn.dataset.adminTab || "products"));
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(statusEl, "");
    const fd = new FormData(loginForm);
    const password = String(fd.get("password") || "");
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      if (data?.token) {
        sessionStorage.setItem(TOKEN_KEY, data.token);
        showDashboard();
        await refreshAll();
      }
    } catch (err) {
      setStatus(statusEl, err instanceof Error ? err.message : "Login failed.", true);
    }
  });

  logoutBtn.addEventListener("click", async () => {
    setStatus(statusEl, "");
    try {
      await api("/api/admin/logout", { method: "POST", body: "{}" });
    } catch {
      /* still clear local */
    }
    showLogin();
    loginForm.reset();
    setStatus(statusEl, "Signed out.");
  });

  async function refreshProducts() {
    const { products } = await api("/api/admin/products");
    productsTbody.replaceChildren();
    for (const p of products) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><code>${escapeHtml(p.id)}</code></td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(formatCents(p.price_cents))}</td>
        <td>${escapeHtml(p.category_slug)}</td>
        <td>${p.is_active ? "Yes" : "No"}</td>
        <td class="admin-row-actions">
          <button type="button" class="text-link" data-act="edit-product" data-id="${encodeAttr(p.id)}">Edit</button>
          <button type="button" class="text-link admin-link-danger" data-act="delete-product" data-id="${encodeAttr(p.id)}">Delete</button>
        </td>`;
      productsTbody.appendChild(tr);
    }
  }

  async function refreshEvents() {
    const { events } = await api("/api/admin/events");
    eventsTbody.replaceChildren();
    for (const ev of events) {
      const tr = document.createElement("tr");
      const dateStr = `${ev.starts_on}`;
      tr.innerHTML = `
        <td>${escapeHtml(dateStr)}</td>
        <td>${escapeHtml(ev.title)}</td>
        <td>${escapeHtml(ev.location)}</td>
        <td>${ev.is_active ? "Yes" : "No"}</td>
        <td class="admin-row-actions">
          <button type="button" class="text-link" data-act="edit-event" data-id="${encodeAttr(ev.id)}">Edit</button>
          <button type="button" class="text-link admin-link-danger" data-act="delete-event" data-id="${encodeAttr(ev.id)}">Delete</button>
        </td>`;
      eventsTbody.appendChild(tr);
    }
  }

  async function refreshAll() {
    setStatus(statusEl, "");
    try {
      await refreshProducts();
      await refreshEvents();
    } catch (err) {
      if (err instanceof Error && err.status === 401) {
        showLogin();
        setStatus(statusEl, "Session expired. Please sign in again.", true);
        return;
      }
      setStatus(statusEl, err instanceof Error ? err.message : "Could not load data.", true);
    }
  }

  function refreshProductImageUi() {
    updateImageSummary(productForm, productImageSummary);
    renderProductImagePreviews(productForm, productImagePreviews);
  }

  function openProductForm(edit = null) {
    setStatus(productFormStatus, "");
    productForm.reset();
    productForm.elements.editingId.value = edit ? edit.id : "";
    productFormTitle.textContent = edit ? "Edit product" : "New product";
    const idInput = productForm.elements.id;
    idInput.disabled = Boolean(edit);
    let initialUrls = [];
    if (edit) {
      if (Array.isArray(edit.image_urls) && edit.image_urls.length > 0) {
        initialUrls = edit.image_urls;
      } else if (edit.hero_image_url && String(edit.hero_image_url).trim()) {
        initialUrls = [String(edit.hero_image_url).trim()];
      }
    }
    productForm.elements.image_urls_state.value = JSON.stringify(initialUrls);
    if (edit) {
      idInput.value = edit.id;
      productForm.elements.name.value = edit.name;
      productForm.elements.description.value = edit.description || "";
      productForm.elements.price_dollars.value = (Number(edit.price_cents) / 100).toFixed(2);
      productForm.elements.category_slug.value = edit.category_slug;
      productForm.elements.category_label.value = edit.category_label;
      productForm.elements.badge.value = edit.badge || "";
      productForm.elements.sort_order.value = String(edit.sort_order ?? 0);
      productForm.elements.is_active.checked = Boolean(edit.is_active);
    } else {
      idInput.value = "";
      productForm.elements.is_active.checked = true;
    }
    refreshProductImageUi();
    productFormPanel.hidden = false;
    if (edit) {
      setProductEditBaselineFromForm();
    } else {
      productEditBaseline = null;
      updateProductSaveButton();
    }
    productFormPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeProductForm() {
    setStatus(productFormStatus, "");
    productEditBaseline = null;
    if (productSubmitBtn) {
      productSubmitBtn.textContent = "Save";
      productSubmitBtn.classList.remove("admin-btn-unsaved");
      productSubmitBtn.removeAttribute("aria-label");
    }
    revokeProductPreviewObjectUrls();
    productImagePreviews?.replaceChildren();
    productFormPanel.hidden = true;
  }

  productForm.addEventListener("input", (e) => {
    if (e.target === productForm.elements.product_images) {
      return;
    }
    updateProductSaveButton();
  });
  productForm.addEventListener("change", (e) => {
    if (e.target === productForm.elements.product_images) {
      return;
    }
    updateProductSaveButton();
  });

  newProductBtn.addEventListener("click", () => openProductForm(null));
  productCancel.addEventListener("click", () => closeProductForm());
  clearProductImagesBtn?.addEventListener("click", async () => {
    setStatus(productFormStatus, "");
    const editingId = productForm.elements.editingId.value.trim();
    if (editingId) {
      try {
        await api(`/api/admin/products/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify({ image_urls: [] })
        });
        productForm.elements.image_urls_state.value = "[]";
        productForm.elements.product_images.value = "";
        refreshProductImageUi();
        syncProductEditBaselineImagesFromForm();
        setStatus(statusEl, "All images removed from this product.");
        await refreshProducts();
      } catch (err) {
        if (err instanceof Error && err.status === 401) {
          showLogin();
        }
        setStatus(productFormStatus, err instanceof Error ? err.message : "Could not clear images.", true);
        productFormStatus?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } else {
      productForm.elements.image_urls_state.value = "[]";
      productForm.elements.product_images.value = "";
      refreshProductImageUi();
      updateProductSaveButton();
    }
  });
  productForm.elements.product_images?.addEventListener("change", async () => {
    const input = productForm.elements.product_images;
    const picked = Array.from(input.files || []).filter(isLikelyImageFile);
    input.value = "";
    if (!picked.length) {
      return;
    }
    const editingId = productForm.elements.editingId.value.trim();
    if (!editingId) {
      setStatus(
        productFormStatus,
        "Save this product first, then choose files again—uploads attach right away.",
        true
      );
      productFormStatus?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    for (let i = 0; i < picked.length; i++) {
      const currentCount = parseImageUrlsState(productForm.elements.image_urls_state.value).length;
      if (currentCount >= MAX_IMAGES_PER_PRODUCT) {
        setStatus(
          productFormStatus,
          `This product already has the maximum of ${MAX_IMAGES_PER_PRODUCT} images. Stopped after ${i} of ${picked.length} file(s).`,
          true
        );
        productFormStatus?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        break;
      }
      setStatus(productFormStatus, `Uploading image ${i + 1} of ${picked.length}…`, false);
      try {
        const image_url = await readSingleImageFileAsDataUrl(picked[i]);
        const data = await api(`/api/admin/products/${encodeURIComponent(editingId)}/images`, {
          method: "POST",
          body: JSON.stringify({ image_url })
        });
        const urls = data?.product?.image_urls;
        if (!Array.isArray(urls)) {
          throw new Error("Invalid response from server.");
        }
        productForm.elements.image_urls_state.value = JSON.stringify(urls);
        refreshProductImageUi();
        syncProductEditBaselineImagesFromForm();
      } catch (err) {
        if (err instanceof Error && err.status === 401) {
          showLogin();
        }
        setStatus(productFormStatus, err instanceof Error ? err.message : "Upload failed.", true);
        productFormStatus?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
    }
    setStatus(productFormStatus, "");
  });

  productForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(productFormStatus, "");
    const editingId = productForm.elements.editingId.value.trim();
    const fd = new FormData(productForm);
    const dollars = Number(fd.get("price_dollars"));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setStatus(productFormStatus, "Enter a valid price in dollars.", true);
      productFormStatus?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    const price_cents = Math.round(dollars * 100);
    if (price_cents < 1) {
      setStatus(productFormStatus, "Price must be at least $0.01.", true);
      productFormStatus?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    let image_urls;
    try {
      image_urls = await buildImageUrlsForSave(productForm);
    } catch (err) {
      setStatus(productFormStatus, err instanceof Error ? err.message : "Could not read images.", true);
      productFormStatus?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    const payload = {
      id: String(fd.get("id") || "").trim(),
      name: String(fd.get("name") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      price_cents,
      category_slug: String(fd.get("category_slug") || "").trim(),
      category_label: String(fd.get("category_label") || "").trim(),
      image_urls,
      badge: String(fd.get("badge") || "").trim() || null,
      sort_order: Number(fd.get("sort_order")),
      is_active: productForm.elements.is_active.checked
    };

    try {
      if (editingId) {
        const patch = { ...payload };
        delete patch.id;
        await api(`/api/admin/products/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify(patch)
        });
        closeProductForm();
        setStatus(statusEl, "Product saved.");
        await refreshProducts();
      } else {
        const data = await api("/api/admin/products", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        const product = data?.product;
        if (!product?.id) {
          setStatus(productFormStatus, "Saved but server returned an unexpected response.", true);
          await refreshProducts();
          return;
        }
        productForm.elements.editingId.value = product.id;
        productForm.elements.id.value = product.id;
        productForm.elements.id.disabled = true;
        let initialUrls = [];
        if (Array.isArray(product.image_urls) && product.image_urls.length > 0) {
          initialUrls = product.image_urls;
        } else if (product.hero_image_url && String(product.hero_image_url).trim()) {
          initialUrls = [String(product.hero_image_url).trim()];
        }
        productForm.elements.image_urls_state.value = JSON.stringify(initialUrls);
        productFormTitle.textContent = "Edit product";
        refreshProductImageUi();
        setProductEditBaselineFromForm();
        setStatus(productFormStatus, "Product saved. You can add more photos with Choose files.");
        setStatus(statusEl, "Product saved.");
        await refreshProducts();
      }
    } catch (err) {
      if (err instanceof Error && err.status === 401) {
        showLogin();
      }
      setStatus(productFormStatus, err instanceof Error ? err.message : "Save failed.", true);
      productFormStatus?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  function openEventForm(edit = null) {
    eventForm.reset();
    eventForm.elements.editingId.value = edit ? edit.id : "";
    eventFormTitle.textContent = edit ? "Edit event" : "New event";
    const idInput = eventForm.elements.id;
    idInput.disabled = Boolean(edit);
    if (edit) {
      idInput.value = edit.id;
      eventForm.elements.starts_on.value = edit.starts_on;
      eventForm.elements.month_key.value = edit.month_key;
      eventForm.elements.date_month_label.value = edit.date_month_label;
      eventForm.elements.date_day.value = String(edit.date_day);
      eventForm.elements.date_year.value = String(edit.date_year);
      eventForm.elements.title.value = edit.title;
      eventForm.elements.location.value = edit.location;
      eventForm.elements.schedule_text.value = edit.schedule_text;
      eventForm.elements.event_type.value = edit.event_type;
      eventForm.elements.lead.value = edit.lead;
      eventForm.elements.extras_json.value = JSON.stringify(edit.extras || [], null, 2);
      eventForm.elements.tags_json.value = JSON.stringify(edit.tags || [], null, 2);
      eventForm.elements.sort_order.value = String(edit.sort_order ?? 0);
      eventForm.elements.is_active.checked = Boolean(edit.is_active);
    } else {
      idInput.value = "";
      eventForm.elements.extras_json.value = defaultExtrasJson();
      eventForm.elements.tags_json.value = defaultTagsJson();
      eventForm.elements.is_active.checked = true;
    }
    eventFormPanel.hidden = false;
    eventFormPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeEventForm() {
    eventFormPanel.hidden = true;
  }

  newEventBtn.addEventListener("click", () => openEventForm(null));
  eventCancel.addEventListener("click", () => closeEventForm());

  eventForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(statusEl, "");
    const editingId = eventForm.elements.editingId.value.trim();
    const fd = new FormData(eventForm);
    let extras;
    let tags;
    try {
      extras = JSON.parse(String(fd.get("extras_json") || "[]"));
      tags = JSON.parse(String(fd.get("tags_json") || "[]"));
    } catch {
      setStatus(statusEl, "Extras and tags must be valid JSON.", true);
      return;
    }
    const payload = {
      id: String(fd.get("id") || "").trim(),
      starts_on: String(fd.get("starts_on") || "").trim(),
      month_key: String(fd.get("month_key") || "").trim().toLowerCase(),
      date_month_label: String(fd.get("date_month_label") || "").trim(),
      date_day: Number(fd.get("date_day")),
      date_year: Number(fd.get("date_year")),
      title: String(fd.get("title") || "").trim(),
      location: String(fd.get("location") || "").trim(),
      schedule_text: String(fd.get("schedule_text") || "").trim(),
      event_type: String(fd.get("event_type") || "").trim(),
      lead: String(fd.get("lead") || "").trim(),
      extras,
      tags,
      sort_order: Number(fd.get("sort_order")),
      is_active: eventForm.elements.is_active.checked
    };

    try {
      if (editingId) {
        const patch = { ...payload };
        delete patch.id;
        await api(`/api/admin/events/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify(patch)
        });
      } else {
        await api("/api/admin/events", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
      closeEventForm();
      setStatus(statusEl, "Event saved.");
      await refreshEvents();
    } catch (err) {
      if (err instanceof Error && err.status === 401) {
        showLogin();
      }
      setStatus(statusEl, err instanceof Error ? err.message : "Save failed.", true);
    }
  });

  productsTbody.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) {
      return;
    }
    const editBtn = t.closest("[data-act='edit-product']");
    const delBtn = t.closest("[data-act='delete-product']");
    if (editBtn) {
      const id = editBtn.getAttribute("data-id");
      if (!id) {
        return;
      }
      try {
        const { product } = await api(`/api/admin/products/${encodeURIComponent(id)}`);
        openProductForm(product);
      } catch (err) {
        setStatus(statusEl, err instanceof Error ? err.message : "Could not load product.", true);
      }
      return;
    }
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      if (!id || !window.confirm(`Delete product "${id}"?`)) {
        return;
      }
      try {
        await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
        setStatus(statusEl, "Product deleted.");
        await refreshProducts();
      } catch (err) {
        setStatus(statusEl, err instanceof Error ? err.message : "Delete failed.", true);
      }
    }
  });

  eventsTbody.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) {
      return;
    }
    const editBtn = t.closest("[data-act='edit-event']");
    const delBtn = t.closest("[data-act='delete-event']");
    if (editBtn) {
      const id = editBtn.getAttribute("data-id");
      if (!id) {
        return;
      }
      try {
        const { event: ev } = await api(`/api/admin/events/${encodeURIComponent(id)}`);
        openEventForm(ev);
      } catch (err) {
        setStatus(statusEl, err instanceof Error ? err.message : "Could not load event.", true);
      }
      return;
    }
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      if (!id || !window.confirm(`Delete event "${id}"?`)) {
        return;
      }
      try {
        await api(`/api/admin/events/${encodeURIComponent(id)}`, { method: "DELETE" });
        setStatus(statusEl, "Event deleted.");
        await refreshEvents();
      } catch (err) {
        setStatus(statusEl, err instanceof Error ? err.message : "Delete failed.", true);
      }
    }
  });

  if (sessionStorage.getItem(TOKEN_KEY)) {
    showDashboard();
    void refreshAll();
  } else {
    showLogin();
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function encodeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

initAdmin();
