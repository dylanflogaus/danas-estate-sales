const MAX_ITEMS = 25;
const MAX_QTY_PER_ITEM = 10;

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

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed." })
    };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing STRIPE_SECRET_KEY server configuration." })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (error) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body." })
    };
  }

  const cartItems = sanitizeCartItems(body?.cartItems);
  const successUrl = String(body?.successUrl || "");
  const cancelUrl = String(body?.cancelUrl || "");

  if (!cartItems.length) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Cart is empty or invalid." })
    };
  }

  if (!isAbsoluteHttpUrl(successUrl) || !isAbsoluteHttpUrl(cancelUrl)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid success or cancel URL." })
    };
  }

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: buildStripeCheckoutBody({ cartItems, successUrl, cancelUrl })
  });

  const stripeData = await stripeResponse.json();
  if (!stripeResponse.ok) {
    const message = stripeData?.error?.message || "Unable to create Stripe checkout session.";
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: message })
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: stripeData.id,
      url: stripeData.url
    })
  };
};
