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

function formatCents(c) {
  return `$${(Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  function openProductForm(edit = null) {
    productForm.reset();
    productForm.elements.editingId.value = edit ? edit.id : "";
    productFormTitle.textContent = edit ? "Edit product" : "New product";
    const idInput = productForm.elements.id;
    idInput.disabled = Boolean(edit);
    if (edit) {
      idInput.value = edit.id;
      productForm.elements.name.value = edit.name;
      productForm.elements.description.value = edit.description || "";
      productForm.elements.price_cents.value = String(edit.price_cents);
      productForm.elements.category_slug.value = edit.category_slug;
      productForm.elements.category_label.value = edit.category_label;
      productForm.elements.image_count.value = String(edit.image_count ?? 4);
      productForm.elements.hero_image_url.value = edit.hero_image_url || "";
      productForm.elements.badge.value = edit.badge || "";
      productForm.elements.sort_order.value = String(edit.sort_order ?? 0);
      productForm.elements.is_active.checked = Boolean(edit.is_active);
    } else {
      idInput.value = "";
      productForm.elements.is_active.checked = true;
    }
    productFormPanel.hidden = false;
    productFormPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeProductForm() {
    productFormPanel.hidden = true;
  }

  newProductBtn.addEventListener("click", () => openProductForm(null));
  productCancel.addEventListener("click", () => closeProductForm());

  productForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(statusEl, "");
    const editingId = productForm.elements.editingId.value.trim();
    const fd = new FormData(productForm);
    const payload = {
      id: String(fd.get("id") || "").trim(),
      name: String(fd.get("name") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      price_cents: Number(fd.get("price_cents")),
      category_slug: String(fd.get("category_slug") || "").trim(),
      category_label: String(fd.get("category_label") || "").trim(),
      image_count: Number(fd.get("image_count")),
      hero_image_url: String(fd.get("hero_image_url") || "").trim() || null,
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
      } else {
        await api("/api/admin/products", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
      closeProductForm();
      setStatus(statusEl, "Product saved.");
      await refreshProducts();
    } catch (err) {
      if (err instanceof Error && err.status === 401) {
        showLogin();
      }
      setStatus(statusEl, err instanceof Error ? err.message : "Save failed.", true);
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
