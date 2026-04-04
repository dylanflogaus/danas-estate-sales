const CART_STORAGE_KEY = "danas_estate_cart_v1";

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
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
}

function upsertCartItem(product, quantityToAdd) {
  const cart = loadCart();
  const existing = cart.find((item) => item.id === product.id);

  if (existing) {
    existing.quantity += quantityToAdd;
  } else {
    cart.push({ ...product, quantity: quantityToAdd });
  }

  saveCart(cart);
  updateCartBadge();
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
  const description = card.querySelector(".item-body p");
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
    button.addEventListener("click", () => {
      const card = button.closest(".item-card");
      if (!card) {
        return;
      }

      const product = buildProductFromCard(card);
      if (!product) {
        setCartMessage("Could not add item to cart. Please try again.", true);
        return;
      }

      upsertCartItem(product, 1);
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
            <button type="button" data-action="decrease" data-id="${item.id}" aria-label="Decrease quantity">-</button>
            <span>${item.quantity}</span>
            <button type="button" data-action="increase" data-id="${item.id}" aria-label="Increase quantity">+</button>
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
        if (action === "increase") {
          return { ...item, quantity: item.quantity + 1 };
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
    const debugRunId = `checkout_${Date.now()}`;

    // #region agent log
    fetch('http://127.0.0.1:7514/ingest/bb62abd7-2372-4ba7-81e8-0a56ddab09ec',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0afdba'},body:JSON.stringify({sessionId:'0afdba',runId:debugRunId,hypothesisId:'H1',location:'main.js:262',message:'checkout click start',data:{cartCount:cart.length,origin:window.location.origin},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (statusMessage) {
      statusMessage.textContent = "Starting secure checkout...";
      statusMessage.classList.remove("error");
    }

    checkoutButton.disabled = true;
    checkoutButton.textContent = "Processing...";

    try {
      const endpoints = ["/api/cart", "/.netlify/functions/cart"];
      const requestBody = JSON.stringify({
        cartItems: cart,
        successUrl: `${window.location.origin}/success.html`,
        cancelUrl: `${window.location.origin}/cancel.html`
      });

      let finalError = "Checkout could not be started.";

      for (const endpoint of endpoints) {
        // #region agent log
        fetch('http://127.0.0.1:7514/ingest/bb62abd7-2372-4ba7-81e8-0a56ddab09ec',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0afdba'},body:JSON.stringify({sessionId:'0afdba',runId:debugRunId,hypothesisId:'H2',location:'main.js:286',message:'requesting checkout endpoint',data:{endpoint},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

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
            // #region agent log
            fetch('http://127.0.0.1:7514/ingest/bb62abd7-2372-4ba7-81e8-0a56ddab09ec',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0afdba'},body:JSON.stringify({sessionId:'0afdba',runId:debugRunId,hypothesisId:'H3',location:'main.js:306',message:'endpoint returned non-json body',data:{endpoint,status:response.status,rawSample:raw.slice(0,120)},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
          }
        }

        // #region agent log
        fetch('http://127.0.0.1:7514/ingest/bb62abd7-2372-4ba7-81e8-0a56ddab09ec',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0afdba'},body:JSON.stringify({sessionId:'0afdba',runId:debugRunId,hypothesisId:'H2',location:'main.js:313',message:'received endpoint response',data:{endpoint,status:response.status,ok:response.ok,hasUrl:Boolean(payload?.url),hasError:Boolean(payload?.error)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        if (response.ok && payload?.url) {
          // #region agent log
          fetch('http://127.0.0.1:7514/ingest/bb62abd7-2372-4ba7-81e8-0a56ddab09ec',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0afdba'},body:JSON.stringify({sessionId:'0afdba',runId:debugRunId,hypothesisId:'H5',location:'main.js:317',message:'redirecting to stripe url',data:{endpoint},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
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
        // #region agent log
        fetch('http://127.0.0.1:7514/ingest/bb62abd7-2372-4ba7-81e8-0a56ddab09ec',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0afdba'},body:JSON.stringify({sessionId:'0afdba',runId:debugRunId,hypothesisId:'H4',location:'main.js:333',message:'all endpoints unresolved',data:{endpointsTried:endpoints},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        throw new Error("Checkout API route was not found. Confirm Cloudflare Pages Functions are enabled and deployed.");
      }
      throw new Error(finalError);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7514/ingest/bb62abd7-2372-4ba7-81e8-0a56ddab09ec',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0afdba'},body:JSON.stringify({sessionId:'0afdba',runId:debugRunId,hypothesisId:'H5',location:'main.js:339',message:'checkout flow failed',data:{errorMessage:error instanceof Error ? error.message : 'unknown'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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

initMobileNav();
initActiveNavLink();
initStoreFilters();
initStoreCartButtons();
renderCartPage();
initSuccessPage();
updateCartBadge();
