const SESSION_HOURS = 24;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function noDbResponse() {
  return jsonResponse({ error: "Database is not configured (D1 binding missing)." }, 503);
}

/**
 * Map common D1 failures to actionable API errors (avoids opaque Worker 500s).
 */
function catalogDbErrorResponse(err) {
  const msg = err && typeof err.message === "string" ? err.message : String(err);
  if (/no such column:\s*image_urls_json/i.test(msg)) {
    return jsonResponse(
      {
        error:
          "Database is missing the image_urls_json column. Run migration 003 on your remote D1 database.",
        hint: "npx wrangler d1 execute danas-estate-sales --file=./migrations/003_product_image_urls.sql"
      },
      503
    );
  }
  return jsonResponse({ error: "Could not load products." }, 500);
}

function methodNotAllowed() {
  return jsonResponse({ error: "Method not allowed." }, 405);
}

function notFound() {
  return jsonResponse({ error: "Not found." }, 404);
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

function getBearerToken(request) {
  const h = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidSlug(s) {
  return typeof s === "string" && s.length >= 2 && s.length <= 120 && SLUG_RE.test(s);
}

async function cleanupExpiredSessions(db) {
  await db.prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')").run();
}

async function validateAdminToken(db, token) {
  if (!token) {
    return false;
  }
  await cleanupExpiredSessions(db);
  const row = await db
    .prepare("SELECT 1 AS ok FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')")
    .bind(token)
    .first();
  return Boolean(row?.ok);
}

async function requireAdmin(request, env) {
  const db = env.DB;
  if (!db) {
    return { error: noDbResponse() };
  }
  const token = getBearerToken(request);
  if (!(await validateAdminToken(db, token))) {
    return { error: jsonResponse({ error: "Unauthorized." }, 401) };
  }
  return { db, token };
}

function parseProductImageUrls(row) {
  try {
    const parsed = JSON.parse(row.image_urls_json || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((u) => typeof u === "string" && u.trim().length > 0);
  } catch {
    return [];
  }
}

const MAX_GALLERY_IMAGES = 20;
const MAX_IMAGE_URL_CHARS = 600_000;
/** D1 max ~2 MB per cell; JSON must stay under this byte size (UTF-8). */
const MAX_IMAGE_URLS_JSON_BYTES = 1_800_000;

function isAllowedProductImageUrl(s) {
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(s)) {
    return true;
  }
  if (/^https?:\/\//i.test(s)) {
    return true;
  }
  if (s.startsWith("/") || /^[a-zA-Z0-9][a-zA-Z0-9/_-]*\//.test(s)) {
    return true;
  }
  return false;
}

/** @returns {{ ok: true, urls: string[] } | { ok: false, error: string }} */
function normalizeImageUrlsInput(raw) {
  if (raw == null) {
    return { ok: true, urls: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: "image_urls must be an array." };
  }
  const urls = [];
  for (const item of raw) {
    if (urls.length >= MAX_GALLERY_IMAGES) {
      break;
    }
    const s = String(item || "").trim();
    if (!s) {
      continue;
    }
    if (s.length > MAX_IMAGE_URL_CHARS) {
      return {
        ok: false,
        error: `Each image may be at most ${MAX_IMAGE_URL_CHARS} characters (try smaller files or host images elsewhere).`
      };
    }
    if (!isAllowedProductImageUrl(s)) {
      return {
        ok: false,
        error: "Invalid image URL (use http(s), a site path like assets/photo.jpg, or an uploaded image)."
      };
    }
    urls.push(s);
  }
  const json = JSON.stringify(urls);
  const jsonBytes = new TextEncoder().encode(json).byteLength;
  if (jsonBytes > MAX_IMAGE_URLS_JSON_BYTES) {
    return {
      ok: false,
      error:
        "All images combined are too large to store (database limit is about 1.8 MB per product). Use fewer photos, smaller files, or host images online and paste https links instead of uploading."
    };
  }
  return { ok: true, urls };
}

function mapProductRow(row) {
  const image_urls = parseProductImageUrls(row);
  const fallbackHero = row.hero_image_url ? String(row.hero_image_url).trim() : "";
  const hero = image_urls[0] || fallbackHero || null;
  const image_count =
    image_urls.length > 0 ? image_urls.length : Number(row.image_count) > 0 ? Number(row.image_count) : 4;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price_cents: row.price_cents,
    category_slug: row.category_slug,
    category_label: row.category_label,
    image_count,
    hero_image_url: hero,
    image_urls,
    badge: row.badge,
    sort_order: row.sort_order,
    is_active: row.is_active
  };
}

function mapEventRow(row) {
  let extras = [];
  let tags = [];
  try {
    extras = JSON.parse(row.extras_json || "[]");
  } catch {
    extras = [];
  }
  try {
    tags = JSON.parse(row.tags_json || "[]");
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    starts_on: row.starts_on,
    month_key: row.month_key,
    date_month_label: row.date_month_label,
    date_day: row.date_day,
    date_year: row.date_year,
    title: row.title,
    location: row.location,
    schedule_text: row.schedule_text,
    event_type: row.event_type,
    lead: row.lead,
    extras,
    tags,
    sort_order: row.sort_order,
    is_active: row.is_active
  };
}

async function handlePublicProducts(env) {
  const db = env.DB;
  // #region agent log
  fetch("http://127.0.0.1:7560/ingest/2bd0fe90-f37e-4218-9e8f-9b2515e16c62", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "eb89e3" },
    body: JSON.stringify({
      sessionId: "eb89e3",
      runId: "pre-fix",
      hypothesisId: "H1",
      location: "catalog-api.js:226",
      message: "handlePublicProducts entry",
      data: { hasDbBinding: Boolean(db) },
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
  if (!db) {
    return noDbResponse();
  }
  try {
    const { results } = await db
      .prepare(
        `SELECT id, name, description, price_cents, category_slug, category_label,
                image_count, hero_image_url, image_urls_json, badge, sort_order, is_active
         FROM products WHERE is_active = 1
         ORDER BY sort_order ASC, id ASC`
      )
      .all();
    const products = (results || []).map(mapProductRow);
    // #region agent log
    fetch("http://127.0.0.1:7560/ingest/2bd0fe90-f37e-4218-9e8f-9b2515e16c62", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "eb89e3" },
      body: JSON.stringify({
        sessionId: "eb89e3",
        runId: "pre-fix",
        hypothesisId: "H2",
        location: "catalog-api.js:240",
        message: "products query succeeded",
        data: { productCount: products.length },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    return jsonResponse({ products });
  } catch (err) {
    // #region agent log
    fetch("http://127.0.0.1:7560/ingest/2bd0fe90-f37e-4218-9e8f-9b2515e16c62", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "eb89e3" },
      body: JSON.stringify({
        sessionId: "eb89e3",
        runId: "pre-fix",
        hypothesisId: "H1",
        location: "catalog-api.js:246",
        message: "products query failed",
        data: { errorMessage: err && typeof err.message === "string" ? err.message : String(err) },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    return catalogDbErrorResponse(err);
  }
}

async function handlePublicEvents(env) {
  const db = env.DB;
  if (!db) {
    return noDbResponse();
  }
  try {
    const { results } = await db
      .prepare(
        `SELECT id, starts_on, month_key, date_month_label, date_day, date_year,
                title, location, schedule_text, event_type, lead, extras_json, tags_json, sort_order, is_active
         FROM events WHERE is_active = 1
         ORDER BY starts_on ASC, sort_order ASC, id ASC`
      )
      .all();
    const events = (results || []).map(mapEventRow);
    return jsonResponse({ events });
  } catch {
    return jsonResponse({ error: "Could not load events." }, 500);
  }
}

async function handleAdminLogin(request, env) {
  const db = env.DB;
  if (!db) {
    return noDbResponse();
  }
  const password = env.ADMIN_PASSWORD;
  if (!password || typeof password !== "string") {
    return jsonResponse({ error: "Admin login is not configured (ADMIN_PASSWORD)." }, 503);
  }
  const body = await readJson(request);
  const submitted = body && typeof body.password === "string" ? body.password : "";
  if (submitted !== password) {
    return jsonResponse({ error: "Invalid credentials." }, 401);
  }
  await cleanupExpiredSessions(db);
  const token = randomToken();
  await db
    .prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, datetime('now', '+24 hours'))")
    .bind(token)
    .run();
  return jsonResponse({ token, expiresInHours: SESSION_HOURS });
}

async function handleAdminLogout(request, env) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const token = getBearerToken(request);
  await r.db.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
  return jsonResponse({ ok: true });
}

async function handleAdminListProducts(request, env) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const { results } = await r.db
    .prepare(
      `SELECT id, name, description, price_cents, category_slug, category_label,
              image_count, hero_image_url, image_urls_json, badge, sort_order, is_active,
              created_at, updated_at
       FROM products ORDER BY sort_order ASC, id ASC`
    )
    .all();
  const products = (results || []).map((row) => {
    const mapped = mapProductRow(row);
    mapped.created_at = row.created_at;
    mapped.updated_at = row.updated_at;
    return mapped;
  });
  return jsonResponse({ products });
}

async function handleAdminGetProduct(request, env, id) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const row = await r.db
    .prepare(
      `SELECT id, name, description, price_cents, category_slug, category_label,
              image_count, hero_image_url, image_urls_json, badge, sort_order, is_active,
              created_at, updated_at
       FROM products WHERE id = ?`
    )
    .bind(id)
    .first();
  if (!row) {
    return notFound();
  }
  const product = mapProductRow(row);
  product.created_at = row.created_at;
  product.updated_at = row.updated_at;
  return jsonResponse({ product });
}

function coerceProductPayload(body, { partial = false, existing = null } = {}) {
  const out = existing
    ? { ...existing }
    : {
        id: "",
        name: "",
        description: "",
        price_cents: 0,
        category_slug: "",
        category_label: "",
        image_count: 4,
        hero_image_url: null,
        image_urls_json: "[]",
        badge: null,
        sort_order: 0,
        is_active: 1
      };

  if (!partial || "id" in body) {
    const id = String(body.id || "").trim();
    if (!isValidSlug(id)) {
      return { error: "Invalid or missing id (use lowercase letters, numbers, hyphens)." };
    }
    out.id = id;
  }
  if (!partial || "name" in body) {
    out.name = String(body.name || "").trim();
    if (!out.name) {
      return { error: "name is required." };
    }
  }
  if (!partial || "description" in body) {
    out.description = String(body.description ?? "").trim();
  }
  if (!partial || "price_cents" in body) {
    const p = Number(body.price_cents);
    if (!Number.isInteger(p) || p <= 0) {
      return { error: "price_cents must be a positive integer." };
    }
    out.price_cents = p;
  }
  if (!partial || "category_slug" in body) {
    out.category_slug = String(body.category_slug || "").trim().toLowerCase();
    if (!isValidSlug(out.category_slug)) {
      return { error: "Invalid category_slug." };
    }
  }
  if (!partial || "category_label" in body) {
    out.category_label = String(body.category_label || "").trim();
    if (!out.category_label) {
      return { error: "category_label is required." };
    }
  }
  if (!partial || "image_count" in body) {
    const n = Number(body.image_count);
    out.image_count = Number.isInteger(n) && n >= 1 && n <= 50 ? n : 4;
  }
  if (!partial || "hero_image_url" in body) {
    const u = body.hero_image_url;
    if (u == null || u === "") {
      out.hero_image_url = null;
    } else {
      const s = String(u).trim();
      out.hero_image_url = s.length ? s : null;
    }
  }
  if (!partial || "image_urls" in body) {
    const norm = normalizeImageUrlsInput(body.image_urls);
    if (!norm.ok) {
      return { error: norm.error };
    }
    const urls = norm.urls;
    out.image_urls_json = JSON.stringify(urls);
    if (urls.length > 0) {
      out.hero_image_url = urls[0];
      out.image_count = urls.length;
    } else if ("image_urls" in body) {
      if (!("hero_image_url" in body)) {
        out.hero_image_url = null;
      }
      out.image_count = 4;
    }
  }
  if (!partial || "badge" in body) {
    const b = body.badge;
    if (b == null || b === "") {
      out.badge = null;
    } else {
      out.badge = String(b).trim().slice(0, 64) || null;
    }
  }
  if (!partial || "sort_order" in body) {
    const s = Number(body.sort_order);
    out.sort_order = Number.isInteger(s) ? s : 0;
  }
  if (!partial || "is_active" in body) {
    out.is_active = body.is_active === false || body.is_active === 0 ? 0 : 1;
  }

  return { value: out };
}

async function handleAdminCreateProduct(request, env) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const body = await readJson(request);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const parsed = coerceProductPayload(body, { partial: false });
  if (parsed.error) {
    return jsonResponse({ error: parsed.error }, 400);
  }
  const p = parsed.value;
  try {
    await r.db
      .prepare(
        `INSERT INTO products (id, name, description, price_cents, category_slug, category_label,
          image_count, hero_image_url, image_urls_json, badge, sort_order, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(
        p.id,
        p.name,
        p.description,
        p.price_cents,
        p.category_slug,
        p.category_label,
        p.image_count,
        p.hero_image_url,
        p.image_urls_json,
        p.badge,
        p.sort_order,
        p.is_active
      )
      .run();
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : "Insert failed.";
    if (msg.includes("UNIQUE")) {
      return jsonResponse({ error: "A product with this id already exists." }, 409);
    }
    return jsonResponse({ error: msg }, 400);
  }
  return jsonResponse({ product: mapProductRow(p) }, 201);
}

/**
 * Append one image (data URL, https, or site path) to a product — saves immediately without full form submit.
 */
async function handleAdminAppendProductImage(request, env, id) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  if (request.method !== "POST") {
    return methodNotAllowed();
  }
  const body = await readJson(request);
  if (!body || typeof body.image_url !== "string") {
    return jsonResponse({ error: "JSON body must include image_url (string)." }, 400);
  }
  const raw = String(body.image_url).trim();
  if (!raw) {
    return jsonResponse({ error: "image_url is empty." }, 400);
  }

  const existing = await r.db.prepare("SELECT * FROM products WHERE id = ?").bind(id).first();
  if (!existing) {
    return notFound();
  }

  const current = parseProductImageUrls(existing);
  if (current.length >= MAX_GALLERY_IMAGES) {
    return jsonResponse(
      { error: `This product already has the maximum of ${MAX_GALLERY_IMAGES} images.` },
      400
    );
  }

  const one = normalizeImageUrlsInput([raw]);
  if (!one.ok) {
    return jsonResponse({ error: one.error }, 400);
  }
  if (one.urls.length !== 1) {
    return jsonResponse({ error: "Invalid image_url." }, 400);
  }

  const next = [...current, one.urls[0]];
  const all = normalizeImageUrlsInput(next);
  if (!all.ok) {
    return jsonResponse({ error: all.error }, 400);
  }
  if (all.urls.length !== next.length) {
    return jsonResponse({ error: "Could not add image (validation failed)." }, 400);
  }

  const mergedJson = JSON.stringify(all.urls);
  const hero = all.urls[0] ?? null;
  try {
    await r.db
      .prepare(
        `UPDATE products SET image_urls_json = ?, hero_image_url = ?, image_count = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(mergedJson, hero, all.urls.length, id)
      .run();
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : "Update failed.";
    const lower = msg.toLowerCase();
    if (lower.includes("too big") || lower.includes("too large") || lower.includes("limit")) {
      return jsonResponse(
        {
          error:
            "This image would make the product too large for storage. Use a smaller file or an https:// image link."
        },
        400
      );
    }
    return jsonResponse({ error: msg }, 400);
  }

  const row = await r.db.prepare("SELECT * FROM products WHERE id = ?").bind(id).first();
  const product = mapProductRow(row);
  product.created_at = row.created_at;
  product.updated_at = row.updated_at;
  return jsonResponse({ product });
}

async function handleAdminPatchProduct(request, env, id) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const existing = await r.db
    .prepare("SELECT * FROM products WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) {
    return notFound();
  }
  const body = await readJson(request);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const parsed = coerceProductPayload(body, { partial: true, existing });
  if (parsed.error) {
    return jsonResponse({ error: parsed.error }, 400);
  }
  const p = parsed.value;
  if (p.id !== id) {
    return jsonResponse({ error: "Cannot change product id; delete and recreate instead." }, 400);
  }
  try {
    await r.db
      .prepare(
        `UPDATE products SET name = ?, description = ?, price_cents = ?, category_slug = ?, category_label = ?,
        image_count = ?, hero_image_url = ?, image_urls_json = ?, badge = ?, sort_order = ?, is_active = ?,
        updated_at = datetime('now')
       WHERE id = ?`
      )
      .bind(
        p.name,
        p.description,
        p.price_cents,
        p.category_slug,
        p.category_label,
        p.image_count,
        p.hero_image_url,
        p.image_urls_json,
        p.badge,
        p.sort_order,
        p.is_active,
        id
      )
      .run();
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : "Update failed.";
    const lower = msg.toLowerCase();
    if (lower.includes("too big") || lower.includes("too large") || lower.includes("limit")) {
      return jsonResponse(
        {
          error:
            "Saved data is too large (often too many embedded photos). Remove some images or use smaller uploads / external image URLs."
        },
        400
      );
    }
    return jsonResponse({ error: msg }, 400);
  }
  const row = await r.db.prepare("SELECT * FROM products WHERE id = ?").bind(id).first();
  const product = mapProductRow(row);
  product.created_at = row.created_at;
  product.updated_at = row.updated_at;
  return jsonResponse({ product });
}

async function handleAdminDeleteProduct(request, env, id) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const res = await r.db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  const changes = res?.meta?.changes ?? 0;
  if (!res?.success || changes === 0) {
    return notFound();
  }
  return jsonResponse({ ok: true });
}

async function handleAdminListEvents(request, env) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const { results } = await r.db
    .prepare(`SELECT * FROM events ORDER BY starts_on ASC, sort_order ASC, id ASC`)
    .all();
  return jsonResponse({ events: (results || []).map(mapEventRow) });
}

async function handleAdminGetEvent(request, env, id) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const row = await r.db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!row) {
    return notFound();
  }
  return jsonResponse({ event: mapEventRow(row) });
}

function coerceEventPayload(body, { partial = false, existing = null } = {}) {
  const out = existing
    ? mapEventRow(existing)
    : {
        id: "",
        starts_on: "",
        month_key: "",
        date_month_label: "",
        date_day: 1,
        date_year: 2026,
        title: "",
        location: "",
        schedule_text: "",
        event_type: "",
        lead: "",
        extras: [],
        tags: [],
        sort_order: 0,
        is_active: 1
      };

  if (!partial || "id" in body) {
    const id = String(body.id || "").trim();
    if (!isValidSlug(id)) {
      return { error: "Invalid or missing id (slug)." };
    }
    out.id = id;
  }
  if (!partial || "starts_on" in body) {
    out.starts_on = String(body.starts_on || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.starts_on)) {
      return { error: "starts_on must be YYYY-MM-DD." };
    }
  }
  if (!partial || "month_key" in body) {
    out.month_key = String(body.month_key || "").trim().toLowerCase();
    if (!/^[a-z]{3}$/.test(out.month_key)) {
      return { error: "month_key must be a 3-letter key (e.g. apr) for filters." };
    }
  }
  if (!partial || "date_month_label" in body) {
    out.date_month_label = String(body.date_month_label || "").trim();
    if (!out.date_month_label) {
      return { error: "date_month_label is required (e.g. Apr)." };
    }
  }
  if (!partial || "date_day" in body) {
    const d = Number(body.date_day);
    if (!Number.isInteger(d) || d < 1 || d > 31) {
      return { error: "date_day must be an integer 1–31." };
    }
    out.date_day = d;
  }
  if (!partial || "date_year" in body) {
    const y = Number(body.date_year);
    if (!Number.isInteger(y) || y < 1900 || y > 2200) {
      return { error: "date_year invalid." };
    }
    out.date_year = y;
  }
  if (!partial || "title" in body) {
    out.title = String(body.title || "").trim();
    if (!out.title) {
      return { error: "title is required." };
    }
  }
  if (!partial || "location" in body) {
    out.location = String(body.location || "").trim();
    if (!out.location) {
      return { error: "location is required." };
    }
  }
  if (!partial || "schedule_text" in body) {
    out.schedule_text = String(body.schedule_text || "").trim();
    if (!out.schedule_text) {
      return { error: "schedule_text is required." };
    }
  }
  if (!partial || "event_type" in body) {
    out.event_type = String(body.event_type || "").trim();
    if (!out.event_type) {
      return { error: "event_type is required." };
    }
  }
  if (!partial || "lead" in body) {
    out.lead = String(body.lead || "").trim();
    if (!out.lead) {
      return { error: "lead is required." };
    }
  }
  if (!partial || "extras" in body) {
    const ex = body.extras;
    if (!Array.isArray(ex)) {
      return { error: "extras must be an array of { label, body }." };
    }
    for (const block of ex) {
      if (!block || typeof block !== "object") {
        return { error: "Invalid extras entry." };
      }
      if (!String(block.label || "").trim() || !String(block.body || "").trim()) {
        return { error: "Each extra needs label and body." };
      }
    }
    out.extras = ex.map((b) => ({
      label: String(b.label).trim(),
      body: String(b.body).trim()
    }));
  }
  if (!partial || "tags" in body) {
    const t = body.tags;
    if (!Array.isArray(t)) {
      return { error: "tags must be an array of strings." };
    }
    out.tags = t.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (!partial || "sort_order" in body) {
    const s = Number(body.sort_order);
    out.sort_order = Number.isInteger(s) ? s : 0;
  }
  if (!partial || "is_active" in body) {
    out.is_active = body.is_active === false || body.is_active === 0 ? 0 : 1;
  }

  return { value: out };
}

async function handleAdminCreateEvent(request, env) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const body = await readJson(request);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const parsed = coerceEventPayload(body, { partial: false });
  if (parsed.error) {
    return jsonResponse({ error: parsed.error }, 400);
  }
  const e = parsed.value;
  const extras_json = JSON.stringify(e.extras);
  const tags_json = JSON.stringify(e.tags);
  try {
    await r.db
      .prepare(
        `INSERT INTO events (id, starts_on, month_key, date_month_label, date_day, date_year, title, location,
          schedule_text, event_type, lead, extras_json, tags_json, sort_order, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(
        e.id,
        e.starts_on,
        e.month_key,
        e.date_month_label,
        e.date_day,
        e.date_year,
        e.title,
        e.location,
        e.schedule_text,
        e.event_type,
        e.lead,
        extras_json,
        tags_json,
        e.sort_order,
        e.is_active
      )
      .run();
  } catch (err) {
    const msg = err && typeof err === "object" && "message" in err ? String(err.message) : "Insert failed.";
    if (msg.includes("UNIQUE")) {
      return jsonResponse({ error: "An event with this id already exists." }, 409);
    }
    return jsonResponse({ error: msg }, 400);
  }
  return jsonResponse({ event: e }, 201);
}

async function handleAdminPatchEvent(request, env, id) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const existing = await r.db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!existing) {
    return notFound();
  }
  const body = await readJson(request);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const parsed = coerceEventPayload(body, { partial: true, existing });
  if (parsed.error) {
    return jsonResponse({ error: parsed.error }, 400);
  }
  const e = parsed.value;
  if (e.id !== id) {
    return jsonResponse({ error: "Cannot change event id; delete and recreate instead." }, 400);
  }
  const extras_json = JSON.stringify(e.extras);
  const tags_json = JSON.stringify(e.tags);
  await r.db
    .prepare(
      `UPDATE events SET starts_on = ?, month_key = ?, date_month_label = ?, date_day = ?, date_year = ?,
        title = ?, location = ?, schedule_text = ?, event_type = ?, lead = ?, extras_json = ?, tags_json = ?,
        sort_order = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .bind(
      e.starts_on,
      e.month_key,
      e.date_month_label,
      e.date_day,
      e.date_year,
      e.title,
      e.location,
      e.schedule_text,
      e.event_type,
      e.lead,
      extras_json,
      tags_json,
      e.sort_order,
      e.is_active,
      id
    )
    .run();
  const row = await r.db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  return jsonResponse({ event: mapEventRow(row) });
}

async function handleAdminDeleteEvent(request, env, id) {
  const r = await requireAdmin(request, env);
  if (r.error) {
    return r.error;
  }
  const res = await r.db.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
  const changes = res?.meta?.changes ?? 0;
  if (!res?.success || changes === 0) {
    return notFound();
  }
  return jsonResponse({ ok: true });
}

/**
 * Handle /api routes other than /api/cart (checkout stays in worker entry).
 * @returns {Response|null} null if this router does not handle the path
 */
export async function dispatchCatalogApi(request, env, pathname) {
  const method = request.method;
  const path = pathname;

  if (path === "/api/products" && method === "GET") {
    return handlePublicProducts(env);
  }
  if (path === "/api/events" && method === "GET") {
    return handlePublicEvents(env);
  }

  if (path === "/api/admin/login" && method === "POST") {
    return handleAdminLogin(request, env);
  }
  if (path === "/api/admin/logout" && method === "POST") {
    return handleAdminLogout(request, env);
  }

  if (path === "/api/admin/products" && method === "GET") {
    return handleAdminListProducts(request, env);
  }
  if (path === "/api/admin/products" && method === "POST") {
    return handleAdminCreateProduct(request, env);
  }

  let m = /^\/api\/admin\/products\/([^/]+)\/images$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === "POST") {
      return handleAdminAppendProductImage(request, env, id);
    }
    return methodNotAllowed();
  }

  m = /^\/api\/admin\/products\/([^/]+)$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === "GET") {
      return handleAdminGetProduct(request, env, id);
    }
    if (method === "PATCH") {
      return handleAdminPatchProduct(request, env, id);
    }
    if (method === "DELETE") {
      return handleAdminDeleteProduct(request, env, id);
    }
    return methodNotAllowed();
  }

  if (path === "/api/admin/events" && method === "GET") {
    return handleAdminListEvents(request, env);
  }
  if (path === "/api/admin/events" && method === "POST") {
    return handleAdminCreateEvent(request, env);
  }

  m = /^\/api\/admin\/events\/([^/]+)$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === "GET") {
      return handleAdminGetEvent(request, env, id);
    }
    if (method === "PATCH") {
      return handleAdminPatchEvent(request, env, id);
    }
    if (method === "DELETE") {
      return handleAdminDeleteEvent(request, env, id);
    }
    return methodNotAllowed();
  }

  return null;
}
