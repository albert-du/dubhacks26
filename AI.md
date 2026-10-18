# AI implementation

Dump uses hosted AI inference APIs and self-hosted pretrained models. It does not train a model or ship a training dataset. Provider adapters use native `fetch`, so there is no OpenAI or Gemini SDK dependency.

| Implementation (actual inference calls) | Model/service | Product use and entry points |
| --- | --- | --- |
| [lib/ai-perceptron.ts](lib/ai-perceptron.ts) | Perceptron Mk1.5, `POST /v1/chat/completions` with image and text messages | Captions, tags, objects, face boxes, and OCR; called by `lib/pipeline.ts` and `lib/photoSearch.ts` |
| [lib/ai-backboard.ts](lib/ai-backboard.ts) | Backboard language model API, `POST /threads/messages` and tool outputs | Natural-language gallery questions and iMessage replies, with bounded tool calling; called by `lib/ask.ts` and `lib/texts.ts` |
| [lib/ai-face-embed.ts](lib/ai-face-embed.ts) | Self-hosted InsightFace `buffalo_l` detection and ArcFace embeddings, `POST /embed` | Selfie enrollment, people grouping, and photo search; inference implementation in `services/face-embed/app.py` |
| [lib/ai-transcribe.ts](lib/ai-transcribe.ts) | Self-hosted faster-whisper via Speaches, `POST /audio/transcriptions` | Video speech transcription and guest-name mentions; called by `lib/pipeline.ts` |
| [lib/cutout.ts](lib/cutout.ts) | Local BiRefNet ONNX inference using `onnxruntime-node` | Background removal for stickers; called by `lib/pipeline.ts` |

Configuration is in `lib/config.ts` and the environment templates. Hosted vision needs `PERCEPTRON_API_KEY`; language features need `BACKBOARD_API_KEY`. `deploy/compose.yml` connects the face and transcription adapters to private services. The sticker model is fetched during the Docker build.

Uploaded photos feed the media pipeline. Selfies and photo-search queries are processed in memory. Hosted vision receives normalized images; Backboard receives gallery text and tool results rather than face vectors. Model outputs enrich search and organization; the fire leaderboard uses human reactions. See [VEYZL.md](VEYZL.md) for retention, deletion, data flows, and known gaps.

For a scanner with a limited source-file budget, start with the four `lib/ai-*.ts` adapters above: they contain the real request bodies, prompts, model configuration, response handling, and timeouts. The Python face service and `lib/cutout.ts` contain the local inference paths.
