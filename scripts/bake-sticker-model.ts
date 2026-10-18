import { ensureStickerModel } from "../lib/stickerModel";

const dest = process.argv[2];
if (!dest) {
  console.error("dest path required");
  process.exit(1);
}

ensureStickerModel(dest).then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
