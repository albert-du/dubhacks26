import { cookies } from "next/headers";

export const VIEWER_COOKIE = "dump_vid";

/** Anonymous per-browser id, set by middleware.ts. No accounts, no PII. */
export async function viewerId(): Promise<string> {
  const v = (await cookies()).get(VIEWER_COOKIE)?.value;
  if (!v) throw new Error("missing viewer cookie");
  return v;
}
