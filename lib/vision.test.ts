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
  let draft = "A solid red image.";
  let verdict = JSON.stringify({ safe: true, grounded: true, disposition: "answer" });
  const server = createServer(async (req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer vision-test-key");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push(body);
    res.setHeader("content-type", "application/json");
    if (fail) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: "private provider details" } }));
    } else {
      res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: body.response_format ? verdict : draft } }] }));
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
    const call = calls.at(-2);
    assert.equal(call.messages[0].role, "system");
    assert.match(call.messages[0].content, /Never invent/);
    assert.equal(calls.at(-1).response_format.type, "json_schema");
    assert.equal(calls.at(-1).response_format.json_schema.strict, true);
    assert.equal(call.model, config.perceptron.model);
    assert.equal(call.messages[1].content[1].text, "What color is this?");
    const forwarded = Buffer.from(call.messages[1].content[0].image_url.url.split(",")[1], "base64");
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
  assert.equal(calls.length, 4, "invalid inputs never call inference");
  fail = true;
  const failed = await POST(request({ image: image.toString("base64") }), undefined);
  assert.equal(failed.status, 502);
  assert.equal(JSON.stringify(await failed.json()).includes("private provider details"), false);
  assert.equal(calls.length, 5, "upstream failures are not retried");
  config.perceptron.apiKey = undefined;
  assert.equal((await POST(request({ image: image.toString("base64") }), undefined)).status, 503);
  assert.equal(calls.length, 5);
  config.perceptron.apiKey = "vision-test-key";
  fail = false;
  const describe = () => POST(request({ image: image.toString("base64") }), undefined);
  draft = "Contact alex@example.com or +1 (206) 555-0199; SSN 123-45-6789.";
  assert.deepEqual(await (await describe()).json(), {
    analysis: "Contact [redacted email] or [redacted number]; SSN [redacted identifier].",
    model: config.perceptron.model,
  });
  assert.equal(JSON.parse(calls.at(-1).messages[1].content[1].text).proposedAnswer.includes("alex@example.com"), false);
  draft = "Unsupported image assertion";
  verdict = JSON.stringify({ safe: true, grounded: false, disposition: "answer" });
  assert.match((await (await describe()).json()).analysis, /based on.*image.*Please provide/);
  verdict = JSON.stringify({ safe: false, grounded: true, disposition: "refuse" });
  assert.equal((await (await describe()).json()).analysis, "I cannot help with that request or provide that information.");
  draft = "I do not have any customer email addresses or phone numbers to share.";
  verdict = JSON.stringify({ safe: true, grounded: true, disposition: "refuse" });
  assert.match((await (await describe()).json()).analysis, /^I cannot help/);
  draft = "The image does not show any verification result.";
  verdict = JSON.stringify({ safe: true, grounded: true, disposition: "insufficient_evidence" });
  const uncertainty = (await (await describe()).json()).analysis;
  assert.match(uncertainty, /based on/);
  assert.match(uncertainty, /Please provide.*non-sensitive.*next step/);
  for (const invalid of ["not JSON", '{"safe":"true","grounded":true}', '{"safe":true}']) {
    verdict = invalid;
    assert.equal((await describe()).status, 502, "invalid review must fail closed");
  }
});
