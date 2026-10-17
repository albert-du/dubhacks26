import { config } from "./config";
import type { Box } from "./types";

/**
 * Client for services/face-embed (InsightFace ArcFace on a Vultr instance).
 * Returns face boxes (normalized 0..1) with L2-normalized 512-d embeddings.
 */
export interface EmbeddedFace {
  box: Box;
  embedding: number[];
  score: number;
}

export const faceEmbed = {
  enabled: () => !!config.faceEmbedUrl,

  async detect(jpeg: Buffer): Promise<EmbeddedFace[]> {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "image.jpg");
    const res = await fetch(`${config.faceEmbedUrl}/embed`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`face-embed ${res.status}`);
    const body = (await res.json()) as { faces: EmbeddedFace[] };
    return body.faces;
  },
};
