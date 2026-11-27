import { once } from "node:events";

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
  const abort = () => {
    incoming?.destroy(signal.reason);
    client.abort();
  };
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
    const chunks = [];
    for await (const chunk of incoming) {
      if (chunk.length) progress();
      chunks.push(chunk);
    }
    return new Response(chunks.length ? Buffer.concat(chunks) : null, {
      status: incoming.statusCode, headers: incoming.headers,
    });
  } finally {
    clearInterval(poll);
    signal.removeEventListener("abort", abort);
  }
};
