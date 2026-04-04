const MAX_ITEMS = 25;
const MAX_QTY_PER_ITEM = 10;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function sanitizeCartItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .slice(0, MAX_ITEMS)
    .map((item) => ({
      id: String(item.id || "").trim(),
      name: String(item.name || "").trim(),
      description: String(item.description || "").trim(),
      price: Number(item.price),
      quantity: Number(item.quantity)
    }))
    .filter((item) => {
      return (
        item.id.length > 0 &&
        item.name.length > 0 &&
        Number.isInteger(item.price) &&
        item.price > 0 &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= MAX_QTY_PER_ITEM
      );
    });
}

function buildStripeCheckoutBody({ cartItems, successUrl, cancelUrl }) {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);

  cartItems.forEach((item, index) => {
    params.set(`line_items[${index}][price_data][currency]`, "usd");
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.price));
    params.set(`line_items[${index}][price_data][product_data][name]`, item.name);
    params.set(`line_items[${index}][price_data][product_data][description]`, item.description || "Estate item");
    params.set(`line_items[${index}][price_data][product_data][metadata][product_id]`, item.id);
    params.set(`line_items[${index}][quantity]`, String(item.quantity));
  });

  return params.toString();
}

function isAbsoluteHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (error) {
    return false;
  }
}

async function handleCheckoutApi(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) {
    return jsonResponse({ error: "Missing STRIPE_SECRET_KEY server configuration." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const cartItems = sanitizeCartItems(body?.cartItems);
  const successUrl = String(body?.successUrl || "");
  const cancelUrl = String(body?.cancelUrl || "");

  if (!cartItems.length) {
    return jsonResponse({ error: "Cart is empty or invalid." }, 400);
  }

  if (!isAbsoluteHttpUrl(successUrl) || !isAbsoluteHttpUrl(cancelUrl)) {
    return jsonResponse({ error: "Invalid success or cancel URL." }, 400);
  }

  try {
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: buildStripeCheckoutBody({ cartItems, successUrl, cancelUrl })
    });

    const stripeRaw = await stripeResponse.text();
    let stripeData = null;
    if (stripeRaw) {
      try {
        stripeData = JSON.parse(stripeRaw);
      } catch (error) {
        stripeData = null;
      }
    }

    if (!stripeResponse.ok) {
      const message = stripeData?.error?.message || "Unable to create Stripe checkout session.";
      return jsonResponse({ error: message }, 502);
    }

    if (!stripeData?.url || !stripeData?.id) {
      return jsonResponse({ error: "Stripe session response was invalid." }, 502);
    }

    return jsonResponse({
      sessionId: stripeData.id,
      url: stripeData.url
    });
  } catch (error) {
    return jsonResponse({ error: "Checkout server error. Please try again." }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/cart") {
      return handleCheckoutApi(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
