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
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");

  if (!toggle || !links) {
    return;
  }

  toggle.addEventListener("click", () => {
    toggle.classList.toggle("open");
    links.classList.toggle("open");
  });

  links.querySelectorAll("a").forEach((anchor) => {
    anchor.addEventListener("click", () => {
      toggle.classList.remove("open");
      links.classList.remove("open");
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

function initStoreFilters() {
  const filterButtons = document.querySelectorAll(".filter-btn");
  if (!filterButtons.length) {
    return;
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      filterButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      const category = button.dataset.cat;
      document.querySelectorAll(".item-card").forEach((card) => {
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

function initStoreCartButtons() {
  const addButtons = document.querySelectorAll(".add-to-cart-btn");
  if (!addButtons.length) {
    return;
  }

  addButtons.forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = button.closest(".item-card");
      if (!card) {
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
      setAddToCartButtonState(button, true);
      syncStoreCartButtonsFromCart();
      setCartMessage(`Added "${product.name}" to your cart.`);
    });
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

function buildStoreGallery(headerEl, imageSrc, slideCount) {
  const count = Math.max(1, slideCount);
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
    img.src = imageSrc;
    img.alt = "";
    img.width = 72;
    img.height = 72;
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

  function update() {
    track.style.transform = `translateX(-${index * 100}%)`;
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
}

function initStoreModal() {
  const modal = document.querySelector("[data-store-modal]");
  const modalContent = document.querySelector("[data-store-modal-content]");
  const modalHeader = document.querySelector("[data-store-modal-header]");
  if (!modal || !modalContent || !modalHeader) {
    return;
  }

  const cards = document.querySelectorAll(".items-grid .item-card");
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
    const iconEl = card.querySelector(".item-placeholder-icon");
    const priceCents = Number(card.dataset.priceCents);

    if (!titleEl || !categoryEl || !descriptionEl || !Number.isInteger(priceCents) || priceCents <= 0) {
      return;
    }

    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    modalHeader.replaceChildren();
    modalContent.replaceChildren();

    const imageSrc = iconEl?.getAttribute("src") || "assets/icons/image.svg";
    const slideCount = Math.max(1, Number.parseInt(card.dataset.imageCount || "4", 10) || 4);
    buildStoreGallery(modalHeader, imageSrc, slideCount);

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

  cards.forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target instanceof HTMLElement && e.target.closest(".add-to-cart-btn")) {
        return;
      }
      openModal(card);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        if (event.target instanceof HTMLElement && event.target.closest(".add-to-cart-btn")) {
          return;
        }
        event.preventDefault();
        openModal(card);
      }
    });
  });

  closeTriggers.forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });
}

function initEventsPage() {
  const modal = document.querySelector("[data-event-modal]");
  const modalContent = document.querySelector("[data-event-modal-content]");
  const modalHeader = modal?.querySelector("[data-event-modal-header]");
  if (!modal || !modalContent || !modalHeader) {
    return;
  }

  const cards = document.querySelectorAll(".events-list .event-card");
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

  cards.forEach((card) => {
    card.addEventListener("click", () => openModal(card));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openModal(card);
      }
    });
  });

  closeTriggers.forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });

  const filterButtons = document.querySelectorAll(".events-filter-btn");
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      filterButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      const month = button.dataset.eventsMonth || "all";
      cards.forEach((card) => {
        const cardMonth = card.dataset.eventMonth || "";
        card.style.display = month === "all" || cardMonth === month ? "" : "none";
      });
    });
  });
}

initMobileNav();
initActiveNavLink();
initStoreFilters();
initStoreCartButtons();
initStoreModal();
syncStoreCartButtonsFromCart();
renderCartPage();
initSuccessPage();
initEventsPage();
updateCartBadge();
