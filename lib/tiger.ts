import { Pool } from "pg";
import { config } from "./config";

/**
 * TigerData (Timescale) metrics. Every call is best-effort: metrics must never
 * break an upload or a purge. Schema lives in sql/tigerdata.sql.
 */
const g = globalThis as unknown as { _dumpTiger?: Pool };

function pool(): Pool | null {
  if (!config.tigerUrl) return null;
  if (!g._dumpTiger) g._dumpTiger = new Pool({ connectionString: config.tigerUrl, max: 5 });
  return g._dumpTiger;
}

async function q(sql: string, params: unknown[]) {
  const p = pool();
  if (!p) return null;
  try {
    return await p.query(sql, params);
  } catch (e) {
    console.warn("[tiger]", (e as Error).message);
    return null;
  }
}

export const tiger = {
  enabled: () => !!config.tigerUrl,

  upload(dumpsterId: string, kind: "image" | "video", bytes: number) {
    return q(`insert into upload_events (time, dumpster_id, kind, bytes) values (now(), $1, $2, $3)`, [dumpsterId, kind, bytes]);
  },

  engagement(dumpsterId: string, type: "join" | "enroll" | "vote" | "sticker" | "view") {
    return q(`insert into engagement_events (time, dumpster_id, type) values (now(), $1, $2)`, [dumpsterId, type]);
  },

  scheduleCleanup(dumpsterId: string, runAt: Date) {
    return q(
      `insert into cleanup_queue (dumpster_id, run_at) values ($1, $2)
       on conflict (dumpster_id) do update set run_at = excluded.run_at`,
      [dumpsterId, runAt],
    );
  },

  cleanupDone(dumpsterId: string, counts: { media: number; vectors: number; objects: number }, reason: string) {
    return Promise.all([
      q(`update cleanup_queue set executed_at = now() where dumpster_id = $1`, [dumpsterId]),
      q(
        `insert into cleanup_runs (time, dumpster_id, media_deleted, vectors_deleted, objects_deleted, reason)
         values (now(), $1, $2, $3, $4, $5)`,
        [dumpsterId, counts.media, counts.vectors, counts.objects, reason],
      ),
    ]);
  },

  /** Uploads per minute for the last `minutes`, oldest first. */
  async velocity(dumpsterId: string, minutes = 15): Promise<{ t: string; n: number }[] | null> {
    const r = await q(
      `select time_bucket('1 minute', time) as t, count(*)::int as n
         from upload_events
        where dumpster_id = $1 and time > now() - make_interval(mins => $2)
        group by 1 order by 1`,
      [dumpsterId, minutes],
    );
    return r ? r.rows.map((row) => ({ t: new Date(row.t).toISOString(), n: row.n })) : null;
  },
};
