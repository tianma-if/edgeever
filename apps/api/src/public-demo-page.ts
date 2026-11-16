import { PUBLIC_DEMO_INSTANCE_URL } from "@edgeever/shared/public-demo";

const canonicalUrl = `${PUBLIC_DEMO_INSTANCE_URL}/`;
const demoHost = new URL(PUBLIC_DEMO_INSTANCE_URL).host;

/** Public Demo presentation policy; independent of storage and hosting APIs. */
export const servePublicDemoRequest = async (
  request: Request,
  next: () => Promise<Response>,
) => {
  const url = new URL(request.url);
  if (url.host !== demoHost) return next();
  // Use the actual request URL, never an untrusted forwarded-proto header.
  if (url.protocol === "http:") {
    url.protocol = "https:";
    return Response.redirect(url.href, 308);
  }

  const response = await next();
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  if (response.status === 304) {
    const headers = new Headers(response.headers);
    headers.set("Link", `<${canonicalUrl}>; rel="canonical"`);
    return new Response(null, { status: 304, headers });
  }
  if (!response.ok || !response.headers.get("Content-Type")?.includes("text/html")) return response;

  const headers = new Headers(response.headers);
  headers.set("Link", `<${canonicalUrl}>; rel="canonical"`);
  // The representation changed; asset lengths and validators no longer apply.
  for (const header of ["Content-Length", "ETag", "Last-Modified", "Content-Encoding"]) {
    headers.delete(header);
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers });
  }
  const html = (await response.text()).replace(
    /<\/head>/i,
    `    <link rel="canonical" href="${canonicalUrl}" />\n  </head>`,
  );
  return new Response(html, { status: response.status, headers });
};
