import { expect, test } from "bun:test";
import { Hono } from "hono";
import { isConfiguredAiEndpoint, registerAiProviderRelay } from "./ai-provider-relay.ts";
const provider = { provider: "openai-compatible", base_url: "https://models.example/v1" };
const target = provider.base_url + "/chat/completions";
const environment = { storage: { db: { prepare: () => ({ bind: (a,b) => {
  expect(a).toBe("workspace-1"); expect(b).toBe("workspace-1");
  return { all: async () => ({ results: [provider] }) };
} }) } } };
const request = (url = target, method = "POST", signal) => new Request("https://notes.example/api/v1/ai/provider-relay", {
  method: "POST", headers: { "x-edgeever-ai-target": url, "x-edgeever-ai-method": method, "x-edgeever-ai-headers": JSON.stringify({ authorization: "Bearer model-key", "content-type": "application/json", cookie: "session=private", "x-admin": "must-not-forward" }) },
  body: JSON.stringify({ model: "test", messages: [] }), signal,
});
const makeApp = (fetchProvider, kind = "user") => {
  const app = new Hono();
  app.use("*", async (c, next) => { if (kind !== "anonymous") c.set("auth", { kind, actorType: "user", actorId: "user-1", workspaceId: "workspace-1", role: "member", scopes: [] }); await next(); });
  registerAiProviderRelay(app, fetchProvider); return app;
};

test("authenticated model relay streams unchanged and strips cookies and unrelated headers", async () => {
  let calls=0;let upstreamSignal;
  const app = makeApp(async (url, init) => {
    calls++; upstreamSignal=init.signal;
    expect(String(url)).toBe(target);expect(init.redirect).toBe("manual");
    expect(init.headers.get("authorization")).toBe("Bearer model-key");
    expect(init.headers.has("cookie")).toBe(false); expect(init.headers.has("x-admin")).toBe(false);
    expect(JSON.parse(await new Response(init.body).text()).model).toBe("test");
    return new Response('data: test\n\n', { headers: { "content-type": "text/event-stream", "set-cookie": "secret=x" } });
  });
  const stop = new AbortController();
  const result = await app.fetch(request(target,"POST",stop.signal), environment);
  expect(result.status).toBe(200);expect(await result.text()).toBe('data: test\n\n');
  expect(result.headers.has("set-cookie")).toBe(false); expect(result.headers.get("cache-control")).toBe("no-store");expect(calls).toBe(1);
  stop.abort();expect(upstreamSignal.aborted).toBe(true);
});
for (const [url,method] of [["https://other.example/v1/chat/completions","POST"],["https://models.example/admin","POST"],["https://models.example/v1/chat/completions?url=https://evil.example","POST"],[target,"DELETE"],["https://user:password@models.example/v1/chat/completions","POST"]]) test(`denies unconfigured or non-model relay targets: ${url} ${method}`,async()=>{
  const app=makeApp(async()=>{throw Error("Must not fetch");});const result=await app.fetch(request(url,method),environment);expect(result.status).toBe(403);
});
test("provider HTTP errors pass through without becoming an instance login failure",async()=>{
 const app=makeApp(async()=>Response.json({error:{message:"Bad key"}},{status:401}));
 expect((await app.fetch(request(),environment)).status).toBe(401);
});
test("anonymous clients cannot use the relay",async()=>{
 const app=makeApp(async()=>{throw Error("Must not fetch");},"anonymous");expect((await app.fetch(request(),environment)).status).toBe(401);
});
test("target matching supports configured Anthropic, Gemini and transcription endpoints",()=>{
 expect(isConfiguredAiEndpoint(new URL('https://anthropic.example/v1/messages'),'POST',{provider:'anthropic',base_url:'https://anthropic.example/v1'})).toBe(true);
 expect(isConfiguredAiEndpoint(new URL('https://google.example/v1beta/models/gemini-test:streamGenerateContent?alt=sse&key=test'),'POST',{provider:'google',base_url:'https://google.example/v1beta'})).toBe(true);
 expect(isConfiguredAiEndpoint(new URL('https://models.example/v1/audio/transcriptions'),'POST',provider)).toBe(true);
 expect(isConfiguredAiEndpoint(new URL('https://models.example/v1/models'),'GET',provider)).toBe(true);
});

test("relay never follows an upstream redirect to an unconfigured destination",async()=>{
 let calls=0;const app=makeApp(async(_url,init)=>{calls++;expect(init.redirect).toBe("manual");return new Response(null,{status:307,headers:{location:"https://unconfigured.example/steal"}});});
 const result=await app.fetch(request(),environment);expect(result.status).toBe(502);expect(calls).toBe(1);expect(result.headers.has("location")).toBe(false);
});

test("Gemini model names cannot escape the configured model endpoint",()=>{
 expect(isConfiguredAiEndpoint(new URL('https://google.example/v1beta/models/%2f..%2fadmin:generateContent'),'POST',{provider:'google',base_url:'https://google.example/v1beta'})).toBe(false);
});

test("model metadata reads used for limit detection are allowed only on the configured endpoint (#652)",()=>{
 const anthropic={provider:'anthropic',base_url:'https://anthropic.example/v1'};
 const google={provider:'google',base_url:'https://google.example/v1beta'};
 const openai={provider:'openai-compatible',base_url:'https://models.example/v1'};
 expect(isConfiguredAiEndpoint(new URL('https://anthropic.example/v1/models/claude-x'),'GET',anthropic)).toBe(true);
 expect(isConfiguredAiEndpoint(new URL('https://google.example/v1beta/models/gemini-x?key=test'),'GET',google)).toBe(true);
 expect(isConfiguredAiEndpoint(new URL('https://models.example/v1/model/info'),'GET',openai)).toBe(true);
 // Not for writes, other paths, queries, other hosts or nested paths.
 expect(isConfiguredAiEndpoint(new URL('https://anthropic.example/v1/models/claude-x'),'POST',anthropic)).toBe(false);
 expect(isConfiguredAiEndpoint(new URL('https://anthropic.example/v1/models/claude-x/extra'),'GET',anthropic)).toBe(false);
 expect(isConfiguredAiEndpoint(new URL('https://anthropic.example/v1/models/claude-x?after_id=1'),'GET',anthropic)).toBe(false);
 expect(isConfiguredAiEndpoint(new URL('https://other.example/v1/models/claude-x'),'GET',anthropic)).toBe(false);
 expect(isConfiguredAiEndpoint(new URL('https://anthropic.example/v1/model/info'),'GET',anthropic)).toBe(false);
 expect(isConfiguredAiEndpoint(new URL('https://models.example/v1/model/info'),'POST',openai)).toBe(false);
 expect(isConfiguredAiEndpoint(new URL('https://models.example/v1/models/gpt-x'),'GET',openai)).toBe(false);
});
