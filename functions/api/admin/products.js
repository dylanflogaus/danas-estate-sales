import { dispatchCatalogApi } from "../../../catalog-api.js";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/products") {
    return new Response(JSON.stringify({ error: "Not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  return dispatchCatalogApi(request, env, "/api/admin/products");
}
