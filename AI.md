# AI implementation

## HTTP vision endpoint

`POST /api/ai/vision` accepts JSON `{ "prompt": "Describe what you see in this image.", "image": "<base64 or data:image/jpeg;base64,...>" }`. It returns `{ "analysis": "<real model response>", "model": "perceptron-mk1.5" }`. The model name follows `PERCEPTRON_MODEL`. No event id or browser sign-in is needed, matching the anonymous photo-search API. Images are limited to 5 MiB, normalized and metadata-stripped in memory, and never stored. Remote image URLs are not fetched. Missing configuration returns 503; invalid input returns 400/413/415; failed inference returns 502, never a placeholder success.

For VEYZL backend audits, set the base URL to `https://dumpster.photo` and manually select **POST `/api/ai/vision`** as the vision target. The SSE stream and Photon webhook are not inference targets; `/embed` belongs to the private face service and is not exposed on the public origin. Use JSON `prompt` and `image` fields, with no authentication header.

Direct self-harm requests and requests to extract hidden instructions or credentials use fixed server-side safe responses. Ordinary image questions still invoke the model and its response reviewer. The public vision endpoint has a system policy for image grounding, safe instruction following, and personal-data protection. Common email, phone, payment-number, and government-identifier formats are redacted in code. A second inference reviews the proposed answer against the image for unsafe or unsupported claims; its verdict must pass a strict boolean schema for safety and grounding. Privacy denials are explicit, including when the model says no records are available. Unsupported answers explain the limitation and request non-sensitive context or an error message as a next step. Rejected answers become a refusal or uncertainty response; malformed or failed reviews return 502. This defense uses a model and pattern matching, so it does not prove factual accuracy or detect every form of personal data. Gallery enrichment uses its existing separate prompt.

## Providers

dump uses hosted AI inference APIs and self-hosted pretrained models. It does not train a model or ship a training dataset. The Perceptron vision adapter uses the official `openai` JavaScript SDK with `baseURL` set to the Perceptron API. It calls `client.chat.completions.create()` with the configured Perceptron model, image input, and vision prompt. Other provider adapters use native `fetch`. The SDK does not change the inference provider or require an OpenAI API key.

| Implementation (actual inference calls) | Model/service | Product use and entry points |
| --- | --- | --- |
| [lib/ai-perceptron.ts](lib/ai-perceptron.ts) | Perceptron Mk1.5, `POST /v1/chat/completions` with image and text messages | Captions, tags, objects, face boxes, and OCR; called by `lib/pipeline.ts` and `lib/photoSearch.ts` |
| [lib/ai-backboard.ts](lib/ai-backboard.ts) | Backboard language model API, `POST /threads/messages` and tool outputs | Natural-language gallery questions and iMessage replies, with bounded tool calling; called by `lib/ask.ts` and `lib/texts.ts` |
| [lib/ai-face-embed.ts](lib/ai-face-embed.ts) | Self-hosted InsightFace `buffalo_l` detection and ArcFace embeddings, `POST /embed` | Selfie enrollment, people grouping, photo search, and faces found in video frames; inference implementation in `services/face-embed/app.py` |
| [lib/ai-transcribe.ts](lib/ai-transcribe.ts) | Self-hosted faster-whisper via Speaches, `POST /audio/transcriptions` | Video speech transcription and guest-name mentions; called by `lib/pipeline.ts` |
| [lib/cutout.ts](lib/cutout.ts) | Local BiRefNet ONNX inference using `onnxruntime-node` | Background removal for stickers; called by `lib/pipeline.ts` |

Configuration is in `lib/config.ts` and the environment templates. Hosted vision needs `PERCEPTRON_API_KEY`; language features need `BACKBOARD_API_KEY`. `deploy/compose.yml` connects the face and transcription adapters to private services. The sticker model is fetched during the Docker build.

Uploaded photos feed the media pipeline. Selfies and photo-search queries are processed in memory. Hosted vision receives normalized images; Backboard receives gallery text and tool results rather than face vectors. Model outputs enrich search and organization; the fire leaderboard uses human reactions. See [VEYZL.md](VEYZL.md) for retention, deletion, data flows, and known gaps.

For a scanner with a limited source-file budget, start with the four `lib/ai-*.ts` adapters above: they contain the real request bodies, prompts, model configuration, response handling, and timeouts. The Python face service and `lib/cutout.ts` contain the local inference paths.
