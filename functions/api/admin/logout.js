import { dispatchCatalogApi } from "../../../catalog-api.js";

export async function onRequest(context) {
  const { request, env } = context;
  return dispatchCatalogApi(request, env, "/api/admin/logout");
}
