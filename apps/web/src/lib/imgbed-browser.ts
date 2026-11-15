import { createImgBedClient } from "@edgeever/image-host/imgbed";

const assertHostShape = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || ["metadata.google.internal", "metadata.goog", "100.100.100.200", "[fd00:ec2::254]"].includes(host)
    || /^(0\.|169\.254\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.|\[(fe[89ab]|ff|::\]))/.test(host)) {
    throw new Error("IMGBED_BROWSER_ADDRESS");
  }
};

// All requests stay in the browser. Never proxy secrets, follow redirects, send
// ambient cookies, or retry a write whose result the browser could not read.
const client = createImgBedClient({
  assertHostShape,
  assertImageHostAllowed: async () => {},
  postImageHostJson: async (url, body, fetchImpl, timeoutMs, { method = "POST", headers }) => {
    if (url.protocol !== "https:") throw new Error("IMGBED_BROWSER_HTTPS");
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method, body, headers, mode: "cors", credentials: "omit", redirect: "error",
        referrerPolicy: "no-referrer", signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // CORS and network failures are intentionally indistinguishable to page JS.
      throw new Error("IMGBED_BROWSER_NETWORK");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`ImgBed HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("ImgBed returned an empty response");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 65536) throw new Error("ImgBed response is too large");
        chunks.push(value);
      }
    } catch {
      throw new Error("IMGBED_BROWSER_RESPONSE");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error("ImgBed returned an unreadable response"); }
  },
});

// Validate before channel preflight or reading an image into memory.
export const assertBrowserImgBedEndpoint = (endpoint: string) => {
  const url = client.normalizeImgBedEndpoint(endpoint);
  if (url.protocol !== "https:") throw new Error("IMGBED_BROWSER_HTTPS");
};
export const browserImgBed = {
  listImgBedChannels: (input: Parameters<typeof client.listImgBedChannels>[0]) => {
    assertBrowserImgBedEndpoint(input.endpoint);
    return client.listImgBedChannels(input);
  },
  testImgBedConnection: (input: Parameters<typeof client.testImgBedConnection>[0]) => {
    assertBrowserImgBedEndpoint(input.endpoint);
    return client.testImgBedConnection(input);
  },
  uploadImgBedImage: (input: Parameters<typeof client.uploadImgBedImage>[0]) => {
    assertBrowserImgBedEndpoint(input.endpoint);
    return client.uploadImgBedImage(input);
  },
};
