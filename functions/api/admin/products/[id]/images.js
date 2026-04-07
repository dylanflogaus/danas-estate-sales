import { dispatchCatalogApi } from "../../../../../catalog-api.js";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  return dispatchCatalogApi(request, env, url.pathname);
}
