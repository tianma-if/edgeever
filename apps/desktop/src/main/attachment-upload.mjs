import { once } from "node:events";
import { addAbortSignal } from "node:stream";

// net.fetch does not expose the Chromium upload counter. Electron's ClientRequest
// uses the same network stack and session. Let Request encode the same multipart body.
export const uploadAttachmentSnapshot = async (net, url, init, progress) => {
  const encoded = new Request(url, init);
  const bytes = Buffer.from(await encoded.arrayBuffer());
  const { signal } = init;
  signal.throwIfAborted();
  const client = net.request({
    url, method: "PUT", headers: Object.fromEntries(encoded.headers),
    credentials: "include", redirect: "error",
  });
  let incoming;
  const abort = () => client.abort();
  signal.addEventListener("abort", abort, { once: true });
  // A network error can arrive after the headers, while the JSON is being read.
  client.on("error", error => incoming?.destroy(error));
  let previous = 0;
  const poll = setInterval(() => {
    const { current } = client.getUploadProgress();
    if (current > previous) {
      previous = current;
      progress();
    }
  }, 1000);
  try {
    const response = once(client, "response", { signal });
    client.end(bytes);
    [incoming] = await response;
    progress();
    // The caller can discard a conflict or unsupported-route body at the headers.
    // Keep cancellation connected to Chromium until the response stream closes.
    incoming.once("close", () => {
      if (!incoming.readableEnded) client.abort();
    });
    addAbortSignal(signal, incoming);
    const responseInit = { status: incoming.statusCode, headers: incoming.headers };
    if ([204, 205, 304].includes(incoming.statusCode)) {
      incoming.resume();
      return new Response(null, responseInit);
    }
    const chunks = incoming[Symbol.asyncIterator]();
    let cancelled = false;
    const body = new ReadableStream({
      async pull(controller) {
        const { done, value } = await chunks.next();
        if (cancelled) return;
        if (done) return controller.close();
        if (value.length) progress();
        controller.enqueue(value);
      },
      cancel() {
        cancelled = true;
        incoming.destroy();
      },
    }, { highWaterMark: 0 });
    return new Response(body, responseInit);
  } catch (error) {
    client.abort();
    throw error;
  } finally {
    clearInterval(poll);
    signal.removeEventListener("abort", abort);
  }
};
