import { dispatchCatalogApi } from "../../catalog-api.js";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.pathname !== "/api/events") {
    return new Response(JSON.stringify({ error: "Not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  const res = await dispatchCatalogApi(request, env, "/api/events");
  return res || new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers: { "Content-Type": "application/json" } });
}
