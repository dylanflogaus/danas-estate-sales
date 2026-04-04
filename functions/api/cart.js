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

export async function onRequestPost(context) {
  const { request, env } = context;
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

  const stripeRequestBody = buildStripeCheckoutBody({ cartItems, successUrl, cancelUrl });

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: stripeRequestBody
  });

  const stripeData = await stripeResponse.json();
  if (!stripeResponse.ok) {
    const message = stripeData?.error?.message || "Unable to create Stripe checkout session.";
    return jsonResponse({ error: message }, 502);
  }

  return jsonResponse({
    sessionId: stripeData.id,
    url: stripeData.url
  });
}
