import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import sharp from "sharp";
import { POST } from "../app/api/ai/vision/route";
import { config } from "./config";

test("vision HTTP endpoint passes real image bytes and the prompt to the SDK", async (t) => {
  const original = { ...config.perceptron };
  const calls: any[] = [];
  let fail = false;
  const server = createServer(async (req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer vision-test-key");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader("content-type", "application/json");
    if (fail) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: "private provider details" } }));
    } else {
      res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "A solid red image." } }] }));
    }
  });
  t.after(() => {
    Object.assign(config.perceptron, original);
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  Object.assign(config.perceptron, { apiKey: "vision-test-key", baseUrl: `http://127.0.0.1:${address.port}/v1` });
  const image = await sharp({ create: { width: 16, height: 12, channels: 3, background: "red" } })
    .withMetadata({ exif: { IFD0: { Artist: "private" } } }).png().toBuffer();
  const request = (body: unknown) => new Request("http://localhost/api/ai/vision", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  for (const data of [image.toString("base64"), `data:image/png;base64,${image.toString("base64")}`]) {
    const response = await POST(request({ prompt: "What color is this?", image: data }), undefined);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { analysis: "A solid red image.", model: config.perceptron.model });
    const call = calls.at(-1);
    assert.equal(call.model, config.perceptron.model);
    assert.equal(call.messages[0].content[1].text, "What color is this?");
    const forwarded = Buffer.from(call.messages[0].content[0].image_url.url.split(",")[1], "base64");
    const metadata = await sharp(forwarded).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 16);
    assert.equal(metadata.exif, undefined);
  }
  for (const [body, status] of [
    [{ image: "https://example.com/private.jpg" }, 400],
    [{ image: Buffer.from("not an image").toString("base64") }, 415],
    [{ image: image.toString("base64"), prompt: "" }, 400],
    [{}, 400],
  ] as const) {
    assert.equal((await POST(request(body), undefined)).status, status);
  }
  const oversized = new Request("http://localhost/api/ai/vision", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(8 * 1024 * 1024) });
  assert.equal((await POST(oversized, undefined)).status, 413);
  assert.equal(calls.length, 2, "invalid inputs never call inference");
  fail = true;
  const failed = await POST(request({ image: image.toString("base64") }), undefined);
  assert.equal(failed.status, 502);
  assert.equal(JSON.stringify(await failed.json()).includes("private provider details"), false);
  assert.equal(calls.length, 3, "upstream failures are not retried");
  config.perceptron.apiKey = undefined;
  assert.equal((await POST(request({ image: image.toString("base64") }), undefined)).status, 503);
  assert.equal(calls.length, 3);
});
