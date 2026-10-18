export const TTL_OPTIONS = [24, 48, 72] as const;
export type TtlHours = (typeof TTL_OPTIONS)[number];

const env = (k: string) => (process.env[k] ? process.env[k] : undefined);

export const config = {
  appUrl: env("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  cronSecret: env("CRON_SECRET"),
  maxUploadBytes: 150 * 1024 * 1024,

  mongoUri: env("MONGODB_URI") ?? "mongodb://localhost:27017",
  mongoDb: env("MONGODB_DB") ?? "dump",
  tigerUrl: env("TIGERDATA_URL"),

  s3: {
    endpoint: env("S3_ENDPOINT"),
    region: env("S3_REGION") ?? "ewr1",
    bucket: env("S3_BUCKET") ?? "dump-media",
    accessKeyId: env("S3_ACCESS_KEY"),
    secretAccessKey: env("S3_SECRET_KEY"),
  },

  perceptron: {
    apiKey: env("PERCEPTRON_API_KEY"),
    baseUrl: env("PERCEPTRON_BASE_URL") ?? "https://api.perceptron.inc/v1",
    model: env("PERCEPTRON_MODEL") ?? "perceptron-mk1.5",
  },
  faceEmbedUrl: env("FACE_EMBED_URL"),
  faceMatchThreshold: Number(env("FACE_MATCH_THRESHOLD") ?? 0.42),

  transcribe: {
    url: env("TRANSCRIBE_URL"),
    apiKey: env("TRANSCRIBE_API_KEY"),
    model: env("TRANSCRIBE_MODEL") ?? "whisper-1",
  },

  /** Read on each access so the worker can load `.env.local` before the first send. */
  get photon() {
    return {
      apiKey: env("PHOTON_API_KEY"),
      projectId: env("PHOTON_PROJECT_ID"),
      agentUserId: env("PHOTON_AGENT_USER_ID"),
      platform: env("PHOTON_PLATFORM") ?? "imessage",
      webhookSecret: env("PHOTON_WEBHOOK_SECRET"),
      baseUrl: (env("PHOTON_API_URL") ?? "https://api.photon.codes/v1").replace(/\/$/, ""),
    };
  },

  backboard: {
    url: env("BACKBOARD_URL"),
    apiKey: env("BACKBOARD_API_KEY"),
  },

  /** How long before expiry the "burning soon" SMS digest goes out. */
  warnBeforeMs: 2 * 60 * 60 * 1000,
  /** Minimum gap between face-alert texts to one guest (batches "3 new photos of you"). */
  alertDebounceMs: 90 * 1000,
  /** Mongo TTL backstop for the dumpster doc itself, after the worker has had time to purge blobs. */
  hardDeleteGraceMs: 6 * 60 * 60 * 1000,
};
