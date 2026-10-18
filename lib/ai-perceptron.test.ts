import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { perceptron } from "./ai-perceptron";
import { config } from "./config";

test("Perceptron SDK preserves the provider, image payload, parsing, and no-retry behavior", async (t) => {
  const original = { ...config.perceptron };
  const calls: { url?: string; authorization?: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.setHeader("content-type", "application/json");
    if (calls.length > 1) {
      res.writeHead(429);
      res.end(JSON.stringify({ error: { message: "slow down" } }));
      return;
    }
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content:
      '{"caption":"A red chair","tags":["chair"]}\n<point_box mention="object:chair" asset_idx="0"> (100,200) (700,900) </point_box>',
    } }] }));
  });
  t.after(() => {
    Object.assign(config.perceptron, original);
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  Object.assign(config.perceptron, { apiKey: "perceptron-test-key", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "perceptron-mk1.5" });

  const image = Buffer.from("test-image-bytes");
  const result = await perceptron.analyze(image);
  assert.equal(calls[0].url, "/v1/chat/completions");
  assert.equal(calls[0].authorization, "Bearer perceptron-test-key");
  assert.equal(calls[0].body.model, "perceptron-mk1.5");
  assert.equal(calls[0].body.temperature, 0);
  assert.equal(calls[0].body.reasoning_effort, "high");
  assert.equal(calls[0].body.max_completion_tokens, 8192);
  assert.deepEqual(calls[0].body.vision_config, { annotation_format: "box" });
  assert.deepEqual(calls[0].body.messages[0].content[0], { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } });
  assert.match(calls[0].body.messages[0].content[1].text, /Label this photo/);
  assert.equal(result.caption, "A red chair");
  assert.deepEqual(result.objects, [{ label: "chair", box: [0.1, 0.2, 0.7, 0.9] }]);

  await assert.rejects(perceptron.analyze(image), /perceptron 429/);
  assert.equal(calls.length, 2, "SDK must not retry a failed inference");
  config.perceptron.apiKey = undefined;
  await assert.rejects(perceptron.analyze(image), /perceptron is not configured/);
  assert.equal(calls.length, 2, "missing credentials must fail before a request");
});
