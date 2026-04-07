const CART_STORAGE_KEY = "danas_estate_cart_v1";

const ADD_TO_CART_LABEL = "Add to Cart";
const ADDED_TO_CART_LABEL = "Added to Cart";

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item.id === "string" && item.id.length > 0)
      .map((item) => ({
        ...item,
        price: Number(item.price) || 0,
        quantity: 1
      }));
  } catch (error) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function getCartItemCount(cart) {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function getCartTotal(cart) {
  return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
}

function formatPrice(cents) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Small centered “icon” treatment: empty hero, generic image.svg, or bundled
 * assets/icons/*.svg (seed catalog). Not used for uploads / external photos.
 */
function isStoreIconOrPlaceholderSrc(src) {
  if (!src || typeof src !== "string") {
    return true;
  }
  const s = src.trim().split("?")[0].split("#")[0];
  if (s === "assets/icons/image.svg" || s.endsWith("/assets/icons/image.svg")) {
    return true;
  }
  return /assets\/icons\/[^/]+\.svg$/i.test(s);
}

function updateCartBadge() {
  const cart = loadCart();
  const count = getCartItemCount(cart);
  document.querySelectorAll("[data-cart-count]").forEach((badge) => {
    badge.textContent = String(count);
  });
  const mobileLabel = count > 99 ? "99+" : String(count);
  document.querySelectorAll("[data-nav-cart-badge]").forEach((badge) => {
    badge.textContent = mobileLabel;
    badge.classList.toggle("is-visible", count > 0);
    badge.setAttribute("aria-hidden", count > 0 ? "false" : "true");
  });
}

function tryAddUniqueCartItem(product) {
  const cart = loadCart();
  if (cart.some((item) => item.id === product.id)) {
    return false;
  }
  cart.push({ ...product, quantity: 1 });
  saveCart(cart);
  updateCartBadge();
  return true;
}

function setAddToCartButtonState(button, inCart) {
  button.textContent = inCart ? ADDED_TO_CART_LABEL : ADD_TO_CART_LABEL;
  button.disabled = inCart;
  button.classList.toggle("is-in-cart", inCart);
}

function syncStoreCartButtonsFromCart() {
  const cart = loadCart();
  const ids = new Set(cart.map((item) => item.id));
  document.querySelectorAll(".items-grid .item-card").forEach((card) => {
    const id = card.dataset.id;
    if (!id) {
      return;
    }
    const btn = card.querySelector(".add-to-cart-btn");
    if (btn) {
      setAddToCartButtonState(btn, ids.has(id));
    }
  });
  const modal = document.querySelector("[data-store-modal]");
  const modalBtn = modal?.querySelector(".store-modal-body .add-to-cart-btn");
  if (modal && !modal.hidden && modalBtn?.dataset.productId) {
    setAddToCartButtonState(modalBtn, ids.has(modalBtn.dataset.productId));
  }
}

function setCartMessage(message, isError = false) {
  const messageNode = document.querySelector("[data-cart-message]");
  if (!messageNode) {
    return;
  }
  messageNode.textContent = message;
  messageNode.classList.toggle("error", isError);
}

function initMobileNav() {
  const toggle = document.querySelector(".nav-menu-toggle");
  const links = document.querySelector(".nav-links");

  if (!toggle || !links) {
    return;
  }

  toggle.addEventListener("click", () => {
    const open = toggle.classList.toggle("open");
    links.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  links.querySelectorAll("a").forEach((anchor) => {
    anchor.addEventListener("click", () => {
      toggle.classList.remove("open");
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

function initActiveNavLink() {
  const current = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (href === current || (current === "" && href === "index.html")) {
      anchor.classList.add("active");
    }
  });
}

function buildStoreCategoryFilterBar(barEl, products) {
  const bySlug = new Map();
  for (const p of products) {
    const slug = p.category_slug;
    if (!slug || bySlug.has(slug)) {
      continue;
    }
    const label = (p.category_label && String(p.category_label).trim()) || slug;
    bySlug.set(slug, label);
  }
  const entries = [...bySlug.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }));

  barEl.replaceChildren();

  function makeBtn(text, slug, active) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "filter-btn" + (active ? " active" : "");
    b.dataset.cat = slug;
    b.textContent = text;
    return b;
  }

  barEl.appendChild(makeBtn("All Items", "all", true));
  for (const [slug, label] of entries) {
    barEl.appendChild(makeBtn(label, slug, false));
  }

  const filterButtons = barEl.querySelectorAll(".filter-btn");
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      filterButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      const category = button.dataset.cat;
      document.querySelectorAll(".items-grid .item-card").forEach((card) => {
        card.style.display = category === "all" || card.dataset.cat === category ? "" : "none";
      });
    });
  });
}

function buildProductFromCard(card) {
  const title = card.querySelector("h3");
  const description =
    card.querySelector(".item-body h3 + p") ?? card.querySelector(".item-body p");
  const category = card.querySelector(".item-category");
  const priceCents = Number(card.dataset.priceCents);
  const id = card.dataset.id;

  if (!id || !Number.isInteger(priceCents) || priceCents <= 0) {
    return null;
  }

  return {
    id,
    name: title ? title.textContent.trim() : "Estate Item",
    description: description ? description.textContent.trim() : "",
    category: category ? category.textContent.trim() : "General",
    price: priceCents
  };
}

let openStoreItemModal = null;

function renderProductCards(grid, products) {
  grid.replaceChildren();
  for (const p of products) {
    const card = document.createElement("div");
    card.className = "item-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", "dialog");
    card.dataset.cat = p.category_slug;
    card.dataset.id = p.id;
    card.dataset.priceCents = String(p.price_cents);
    card.dataset.imageCount = String(p.image_count ?? 4);
    const galleryUrls = Array.isArray(p.image_urls) && p.image_urls.length > 0 ? p.image_urls : null;
    if (galleryUrls) {
      card.dataset.productImageUrls = JSON.stringify(galleryUrls);
    } else {
      delete card.dataset.productImageUrls;
    }
    const imgSrc =
      (galleryUrls && galleryUrls[0]) || p.hero_image_url || "assets/icons/image.svg";
    const thumbClass = isStoreIconOrPlaceholderSrc(imgSrc)
      ? "item-card-thumb item-card-thumb--icon"
      : "item-card-thumb item-card-thumb--photo";
    const badgeHtml = p.badge
      ? `<span class="item-badge">${escapeHtml(p.badge)}</span>`
      : "";
    card.innerHTML = `
      <div class="item-img">
        <img src="${escapeHtml(imgSrc)}" alt="" class="${thumbClass}" loading="lazy" />
        ${badgeHtml}
      </div>
      <div class="item-body">
        <p class="item-card-hint">View photos &amp; details</p>
        <div class="item-category">${escapeHtml(p.category_label)}</div>
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.description)}</p>
        <div class="item-price">${escapeHtml(formatPrice(p.price_cents))}</div>
        <button class="add-to-cart-btn" type="button">Add to Cart</button>
      </div>`;
    grid.appendChild(card);
  }
}

async function bootstrapStorePage() {
  const grid = document.querySelector("[data-dynamic-catalog]");
  const status = document.querySelector("[data-catalog-status]");
  if (status) {
    status.classList.remove("error");
    status.textContent = grid ? "Loading catalog…" : "";
  }
  if (!grid) {
    return;
  }
  try {
    const res = await fetch("/api/products");
    const data = res.ok ? await res.json() : await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg =
        data && typeof data.error === "string" && data.error.trim()
          ? data.error
          : "Could not load products.";
      if (data && typeof data.hint === "string" && data.hint.trim()) {
        msg = `${msg} — ${data.hint}`;
      }
      throw new Error(msg);
    }
    const products = Array.isArray(data.products) ? data.products : [];
    renderProductCards(grid, products);
    const filterBar = document.querySelector("[data-store-filters]");
    if (filterBar) {
      buildStoreCategoryFilterBar(filterBar, products);
    }
    if (status) {
      status.textContent = "";
    }
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : "Unable to load catalog.";
      status.classList.add("error");
    }
  }
  syncStoreCartButtonsFromCart();
}

function initStoreGridInteractions() {
  const grid = document.querySelector(".items-grid");
  if (!grid || grid.dataset.gridInteractions === "1") {
    return;
  }
  grid.dataset.gridInteractions = "1";
  ensureStoreModalShell();

  grid.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) {
      return;
    }
    const addBtn = t.closest(".add-to-cart-btn");
    if (addBtn) {
      e.stopPropagation();
      const card = addBtn.closest(".item-card");
      if (!card || !grid.contains(card)) {
        return;
      }
      const product = buildProductFromCard(card);
      if (!product) {
        setCartMessage("Could not add item to cart. Please try again.", true);
        return;
      }
      if (!tryAddUniqueCartItem(product)) {
        setCartMessage(`"${product.name}" is already in your cart.`, true);
        return;
      }
      setAddToCartButtonState(addBtn, true);
      syncStoreCartButtonsFromCart();
      setCartMessage(`Added "${product.name}" to your cart.`);
      return;
    }
    const card = t.closest(".item-card");
    if (card && grid.contains(card) && openStoreItemModal) {
      openStoreItemModal(card);
    }
  });

  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") {
      return;
    }
    const t = e.target;
    if (!(t instanceof HTMLElement)) {
      return;
    }
    if (t.closest(".add-to-cart-btn")) {
      return;
    }
    const card = t.closest(".item-card");
    if (card && grid.contains(card) && openStoreItemModal) {
      e.preventDefault();
      openStoreItemModal(card);
    }
  });
}

function renderCartPage() {
  const cartRoot = document.querySelector("[data-cart-page]");
  if (!cartRoot) {
    return;
  }

  const cartItemsWrap = document.querySelector("[data-cart-items]");
  const emptyState = document.querySelector("[data-cart-empty]");
  const summaryWrap = document.querySelector("[data-cart-summary]");
  const totalWrap = document.querySelector("[data-cart-total]");
  const checkoutButton = document.querySelector("[data-cart-checkout]");
  const clearButton = document.querySelector("[data-cart-clear]");
  const statusMessage = document.querySelector("[data-cart-status]");

  function render() {
    const cart = loadCart();

    if (!cartItemsWrap || !emptyState || !summaryWrap || !totalWrap || !checkoutButton) {
      return;
    }

    cartItemsWrap.innerHTML = "";

    if (!cart.length) {
      emptyState.hidden = false;
      summaryWrap.hidden = true;
      updateCartBadge();
      return;
    }

    emptyState.hidden = true;
    summaryWrap.hidden = false;

    cart.forEach((item) => {
      const row = document.createElement("div");
      row.className = "cart-item";
      row.innerHTML = `
        <div class="cart-item-main">
          <p class="cart-item-category">${item.category || "Estate Item"}</p>
          <h3>${item.name}</h3>
          <p class="cart-item-description">${item.description || ""}</p>
        </div>
        <div class="cart-item-controls">
          <div class="qty-controls">
            <button type="button" data-action="decrease" data-id="${item.id}" aria-label="Remove item">-</button>
            <span>${item.quantity}</span>
          </div>
          <div class="cart-item-price">${formatPrice(item.price * item.quantity)}</div>
          <button type="button" class="text-link" data-action="remove" data-id="${item.id}">Remove</button>
        </div>
      `;
      cartItemsWrap.appendChild(row);
    });

    totalWrap.textContent = formatPrice(getCartTotal(cart));
    updateCartBadge();
  }

  cartItemsWrap?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    const id = target.dataset.id;
    if (!action || !id) {
      return;
    }

    const cart = loadCart();
    const next = cart
      .map((item) => {
        if (item.id !== id) {
          return item;
        }
        if (action === "decrease") {
          return { ...item, quantity: item.quantity - 1 };
        }
        return item;
      })
      .filter((item) => (action === "remove" && item.id === id ? false : item.quantity > 0));

    saveCart(next);
    render();
  });

  clearButton?.addEventListener("click", () => {
    saveCart([]);
    if (statusMessage) {
      statusMessage.textContent = "";
    }
    render();
  });

  checkoutButton?.addEventListener("click", async () => {
    const cart = loadCart();
    if (!cart.length) {
      return;
    }

    if (statusMessage) {
      statusMessage.textContent = "Starting secure checkout...";
      statusMessage.classList.remove("error");
    }

    checkoutButton.disabled = true;
    checkoutButton.textContent = "Processing...";

    try {
      const endpoints = ["/api/cart"];
      const requestBody = JSON.stringify({
        cartItems: cart,
        successUrl: `${window.location.origin}/success.html`,
        cancelUrl: `${window.location.origin}/cancel.html`
      });

      let finalError = "Checkout could not be started.";

      for (const endpoint of endpoints) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: requestBody
        });

        const raw = await response.text();
        let payload = null;
        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch (parseError) {
            payload = null;
          }
        }

        if (response.ok && payload?.url) {
          window.location.href = payload.url;
          return;
        }

        if (response.status !== 404) {
          const fallback = raw ? raw.slice(0, 180) : "";
          finalError = payload?.error || fallback || `Checkout failed (${response.status}).`;
          break;
        }
      }

      if (finalError === "Checkout could not be started.") {
        throw new Error("Checkout API route was not found.");
      }
      throw new Error(finalError);
    } catch (error) {
      if (statusMessage) {
        statusMessage.textContent = error instanceof Error ? error.message : "Checkout failed. Please try again.";
        statusMessage.classList.add("error");
      }
      checkoutButton.disabled = false;
      checkoutButton.textContent = "Proceed to Secure Checkout";
    }
  });

  render();
}

function initSuccessPage() {
  const successRoot = document.querySelector("[data-checkout-success]");
  if (!successRoot) {
    return;
  }
  saveCart([]);
  updateCartBadge();
}

function buildStoreGallery(headerEl, imageSources) {
  const sources =
    Array.isArray(imageSources) && imageSources.length > 0
      ? imageSources
      : [typeof imageSources === "string" ? imageSources : "assets/icons/image.svg"];
  const count = Math.max(1, sources.length);
  const wrap = document.createElement("div");
  wrap.className = "store-gallery";
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Item images");
  wrap.tabIndex = -1;

  const viewport = document.createElement("div");
  viewport.className = "store-gallery-viewport";

  const track = document.createElement("div");
  track.className = "store-gallery-track";

  for (let i = 0; i < count; i += 1) {
    const slide = document.createElement("div");
    slide.className = "store-gallery-slide";
    const img = document.createElement("img");
    const slideSrc = sources[i] || sources[0];
    img.src = slideSrc;
    img.alt = "";
    img.className = isStoreIconOrPlaceholderSrc(slideSrc)
      ? "store-gallery-img store-gallery-img--placeholder"
      : "store-gallery-img store-gallery-img--photo";
    slide.appendChild(img);
    track.appendChild(slide);
  }

  viewport.appendChild(track);

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "store-gallery-nav store-gallery-prev";
  prev.setAttribute("aria-label", "Previous image");
  prev.textContent = "\u2039";

  const next = document.createElement("button");
  next.type = "button";
  next.className = "store-gallery-nav store-gallery-next";
  next.setAttribute("aria-label", "Next image");
  next.textContent = "\u203a";

  viewport.appendChild(prev);
  viewport.appendChild(next);

  const dots = document.createElement("div");
  dots.className = "store-gallery-dots";

  for (let i = 0; i < count; i += 1) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "store-gallery-dot";
    dot.setAttribute("aria-label", `Image ${i + 1} of ${count}`);
    dot.dataset.index = String(i);
    dots.appendChild(dot);
  }

  const status = document.createElement("p");
  status.className = "store-gallery-status";
  status.setAttribute("aria-live", "polite");

  wrap.appendChild(viewport);
  wrap.appendChild(dots);
  wrap.appendChild(status);

  headerEl.appendChild(wrap);

  let index = 0;

  function slideStepPx() {
    const first = track.firstElementChild;
    if (first instanceof HTMLElement) {
      const w = first.getBoundingClientRect().width;
      if (w > 0) {
        return w;
      }
    }
    return viewport.clientWidth || 0;
  }

  function update() {
    const step = slideStepPx();
    track.style.transform =
      step > 0 ? `translateX(-${Math.round(index * step)}px)` : "";
    if (count <= 1) {
      prev.hidden = true;
      next.hidden = true;
      dots.hidden = true;
      status.textContent = "";
      return;
    }
    prev.hidden = false;
    next.hidden = false;
    dots.hidden = false;
    prev.disabled = index <= 0;
    next.disabled = index >= count - 1;
    status.textContent = `Image ${index + 1} of ${count}`;
    dots.querySelectorAll(".store-gallery-dot").forEach((dot, i) => {
      const on = i === index;
      dot.classList.toggle("is-active", on);
      if (on) {
        dot.setAttribute("aria-current", "true");
      } else {
        dot.removeAttribute("aria-current");
      }
    });
  }

  function go(delta) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= count) {
      return;
    }
    index = nextIndex;
    update();
  }

  prev.addEventListener("click", (e) => {
    e.stopPropagation();
    go(-1);
  });
  next.addEventListener("click", (e) => {
    e.stopPropagation();
    go(1);
  });
  dots.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const dot = target.closest(".store-gallery-dot");
    if (!dot) {
      return;
    }
    e.stopPropagation();
    const i = Number.parseInt(dot.dataset.index || "0", 10);
    if (!Number.isNaN(i) && i >= 0 && i < count) {
      index = i;
      update();
    }
  });

  wrap.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    }
  });

  update();
  requestAnimationFrame(() => update());
}

function ensureStoreModalShell() {
  const modal = document.querySelector("[data-store-modal]");
  const modalContent = document.querySelector("[data-store-modal-content]");
  const modalHeader = document.querySelector("[data-store-modal-header]");
  if (!modal || !modalContent || !modalHeader || modal.dataset.modalShellBound === "1") {
    return;
  }
  modal.dataset.modalShellBound = "1";

  const closeTriggers = modal.querySelectorAll("[data-store-modal-close]");
  let lastFocused = null;

  function closeModal() {
    modal.hidden = true;
    document.body.style.removeProperty("overflow");
    modalHeader.replaceChildren();
    modalContent.replaceChildren();
    if (lastFocused && document.body.contains(lastFocused)) {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  function openModal(card) {
    const titleEl = card.querySelector(".item-body h3");
    const categoryEl = card.querySelector(".item-category");
    const descriptionEl = card.querySelector(".item-body h3 + p");
    const priceEl = card.querySelector(".item-price");
    const iconEl = card.querySelector(".item-card-thumb");
    const priceCents = Number(card.dataset.priceCents);

    if (!titleEl || !categoryEl || !descriptionEl || !Number.isInteger(priceCents) || priceCents <= 0) {
      return;
    }

    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    modalHeader.replaceChildren();
    modalContent.replaceChildren();

    const imageSrc = iconEl?.getAttribute("src") || "assets/icons/image.svg";
    let gallerySources = null;
    try {
      const raw = card.dataset.productImageUrls;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          gallerySources = parsed;
        }
      }
    } catch {
      gallerySources = null;
    }
    const slideCount = Math.max(1, Number.parseInt(card.dataset.imageCount || "4", 10) || 4);
    const modalSources =
      gallerySources && gallerySources.length > 0
        ? gallerySources
        : Array.from({ length: slideCount }, () => imageSrc);
    buildStoreGallery(modalHeader, modalSources);

    const right = document.createElement("div");
    right.className = "event-modal-body store-modal-body";

    const heading = document.createElement("h2");
    heading.id = "store-modal-title";
    heading.className = "event-modal-heading";
    heading.textContent = titleEl.textContent.trim();

    const categoryClone = categoryEl.cloneNode(true);

    const leadP = document.createElement("p");
    leadP.className = "event-modal-lead store-modal-description";
    leadP.textContent = descriptionEl.textContent.trim();

    const priceRow = document.createElement("div");
    priceRow.className = "store-modal-price";
    priceRow.textContent = priceEl ? priceEl.textContent.trim() : formatPrice(priceCents);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-to-cart-btn";
    addBtn.dataset.productId = card.dataset.id || "";
    addBtn.textContent = ADD_TO_CART_LABEL;
    const alreadyInCart = loadCart().some((item) => item.id === card.dataset.id);
    setAddToCartButtonState(addBtn, alreadyInCart);
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const product = buildProductFromCard(card);
      if (!product) {
        setCartMessage("Could not add item to cart. Please try again.", true);
        return;
      }
      if (!tryAddUniqueCartItem(product)) {
        setCartMessage(`"${product.name}" is already in your cart.`, true);
        return;
      }
      setAddToCartButtonState(addBtn, true);
      syncStoreCartButtonsFromCart();
      setCartMessage(`Added "${product.name}" to your cart.`);
    });

    right.appendChild(heading);
    right.appendChild(categoryClone);
    right.appendChild(leadP);
    right.appendChild(priceRow);
    right.appendChild(addBtn);

    modalContent.appendChild(right);

    modal.hidden = false;
    document.body.style.overflow = "hidden";

    modal.querySelector(".event-modal-close")?.focus();
  }

  openStoreItemModal = openModal;

  closeTriggers.forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });
}

const MONTH_FILTER_LABELS = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December"
};

function buildMonthFilterBar(barEl, events) {
  barEl.replaceChildren();
  const seen = new Set();
  const keys = [];
  for (const ev of events) {
    const k = ev.month_key;
    if (k && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }

  function makeBtn(label, key, active) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "filter-btn events-filter-btn" + (active ? " active" : "");
    b.dataset.eventsMonth = key;
    b.textContent = label;
    return b;
  }

  barEl.appendChild(makeBtn("All", "all", true));
  for (const m of keys) {
    barEl.appendChild(makeBtn(MONTH_FILTER_LABELS[m] || m, m, false));
  }

  function filterButtons() {
    return barEl.querySelectorAll(".events-filter-btn");
  }

  filterButtons().forEach((button) => {
    button.addEventListener("click", () => {
      filterButtons().forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      const month = button.dataset.eventsMonth || "all";
      document.querySelectorAll(".events-list .event-card").forEach((card) => {
        const cardMonth = card.dataset.eventMonth || "";
        card.style.display = month === "all" || cardMonth === month ? "" : "none";
      });
    });
  });
}

function renderEventCards(listEl, events) {
  listEl.replaceChildren();
  for (const ev of events) {
    const article = document.createElement("article");
    article.className = "event-card";
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.setAttribute("aria-haspopup", "dialog");
    article.dataset.eventMonth = ev.month_key;
    const extrasBlocks = (ev.extras || [])
      .map(
        (b) => `<div class="event-extra-block">
        <h4 class="event-extra-label">${escapeHtml(b.label)}</h4>
        <p>${escapeHtml(b.body)}</p>
      </div>`
      )
      .join("");
    const tags = (ev.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
    article.innerHTML = `
      <div class="event-card-date">
        <div class="month">${escapeHtml(ev.date_month_label)}</div>
        <div class="day">${escapeHtml(String(ev.date_day))}</div>
        <div class="year">${escapeHtml(String(ev.date_year))}</div>
      </div>
      <div class="event-card-body">
        <p class="event-card-hint">View full details</p>
        <h3>${escapeHtml(ev.title)}</h3>
        <div class="event-meta">
          <span><img src="assets/icons/map-pin.svg" alt="" class="event-meta-icon" width="14" height="14" /> ${escapeHtml(ev.location)}</span>
          <span><img src="assets/icons/clock.svg" alt="" class="event-meta-icon" width="14" height="14" /> ${escapeHtml(ev.schedule_text)}</span>
          <span><img src="assets/icons/tag.svg" alt="" class="event-meta-icon" width="14" height="14" /> ${escapeHtml(ev.event_type)}</span>
        </div>
        <p class="event-card-lead">${escapeHtml(ev.lead)}</p>
        <div class="event-card-extras" aria-hidden="true">
          <div class="event-extra-grid">${extrasBlocks}</div>
        </div>
        <div class="event-tags">${tags}</div>
      </div>`;
    listEl.appendChild(article);
  }
}

async function bootstrapEventsPage() {
  const listEl = document.querySelector("[data-dynamic-events]");
  const barEl = document.querySelector("[data-events-filter-bar]");
  const status = document.querySelector("[data-events-status]");
  if (!listEl || !barEl) {
    return;
  }
  if (status) {
    status.classList.remove("error");
    status.textContent = "Loading events…";
  }
  try {
    const res = await fetch("/api/events");
    if (!res.ok) {
      throw new Error("Could not load events.");
    }
    const data = await res.json();
    const events = Array.isArray(data.events) ? data.events : [];
    renderEventCards(listEl, events);
    buildMonthFilterBar(barEl, events);
    if (status) {
      status.textContent = "";
    }
    initEventsListDelegation();
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : "Unable to load events.";
      status.classList.add("error");
    }
  }
}

let openEventItemModal = null;

function ensureEventsModalShell() {
  const modal = document.querySelector("[data-event-modal]");
  const modalContent = document.querySelector("[data-event-modal-content]");
  const modalHeader = modal?.querySelector("[data-event-modal-header]");
  if (!modal || !modalContent || !modalHeader || modal.dataset.modalShellBound === "1") {
    return;
  }
  modal.dataset.modalShellBound = "1";

  const closeTriggers = modal.querySelectorAll("[data-event-modal-close]");
  let lastFocused = null;

  function closeModal() {
    modal.hidden = true;
    document.body.style.removeProperty("overflow");
    modalHeader.replaceChildren();
    modalContent.replaceChildren();
    if (lastFocused && document.body.contains(lastFocused)) {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  function openModal(card) {
    const dateEl = card.querySelector(".event-card-date");
    const body = card.querySelector(".event-card-body");
    const titleEl = body?.querySelector("h3");
    const meta = body?.querySelector(".event-meta");
    const lead = body?.querySelector(".event-card-lead");
    const extras = body?.querySelector(".event-card-extras");
    const tags = body?.querySelector(".event-tags");

    if (!dateEl || !body || !titleEl || !meta || !lead) {
      return;
    }

    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    modalHeader.replaceChildren();
    modalContent.innerHTML = "";

    const dateClone = dateEl.cloneNode(true);
    modalHeader.appendChild(dateClone);

    const right = document.createElement("div");
    right.className = "event-modal-body";

    const heading = document.createElement("h2");
    heading.id = "event-modal-title";
    heading.className = "event-modal-heading";
    heading.textContent = titleEl.textContent.trim();

    const metaClone = meta.cloneNode(true);

    const leadP = document.createElement("p");
    leadP.className = "event-modal-lead";
    leadP.textContent = lead.textContent.trim();

    right.appendChild(heading);
    right.appendChild(metaClone);
    right.appendChild(leadP);

    if (extras) {
      const ornament = document.createElement("div");
      ornament.className = "event-modal-ornament";
      ornament.innerHTML =
        '<span class="ornament-mark" aria-hidden="true"><img src="assets/icons/star.svg" alt="" width="14" height="14" /></span>';
      const hint = document.createElement("p");
      hint.className = "event-modal-hint";
      hint.textContent = "Practical details";
      right.appendChild(ornament);
      right.appendChild(hint);
      const extrasClone = extras.cloneNode(true);
      extrasClone.removeAttribute("aria-hidden");
      right.appendChild(extrasClone);
    }

    if (tags) {
      right.appendChild(tags.cloneNode(true));
    }

    modalContent.appendChild(right);

    modal.hidden = false;
    document.body.style.overflow = "hidden";

    modal.querySelector(".event-modal-close")?.focus();
  }

  openEventItemModal = openModal;

  closeTriggers.forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });
}

function initEventsListDelegation() {
  const listEl = document.querySelector(".events-list");
  if (!listEl || listEl.dataset.listInteractions === "1") {
    return;
  }
  listEl.dataset.listInteractions = "1";

  ensureEventsModalShell();

  listEl.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) {
      return;
    }
    const card = t.closest(".event-card");
    if (card && listEl.contains(card) && openEventItemModal) {
      openEventItemModal(card);
    }
  });

  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") {
      return;
    }
    const t = e.target;
    if (!(t instanceof HTMLElement)) {
      return;
    }
    const card = t.closest(".event-card");
    if (card && listEl.contains(card) && openEventItemModal) {
      e.preventDefault();
      openEventItemModal(card);
    }
  });
}

function initEventsPage() {
  if (document.querySelector("[data-dynamic-events]")) {
    void bootstrapEventsPage();
  }
}

initMobileNav();
initActiveNavLink();
initStoreGridInteractions();
if (document.querySelector("[data-dynamic-catalog]")) {
  void bootstrapStorePage();
} else {
  syncStoreCartButtonsFromCart();
}
renderCartPage();
initSuccessPage();
initEventsPage();
updateCartBadge();
