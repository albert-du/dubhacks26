"use client";

import type { useUploader, UploadItem } from "@/lib/client/useUploader";
import type { PublicDumpster } from "@/lib/types";

const STATUS: Record<UploadItem["state"], string> = {
  queued: "Queued",
  uploading: "Throwing",
  waiting: "No signal — held on your phone",
  processing: "Landed · scanning faces",
  failed: "Rejected",
};

export function Drop({
  dumpster,
  uploader,
  onCopyLink,
  copied,
}: {
  dumpster: PublicDumpster;
  uploader: ReturnType<typeof useUploader>;
  onCopyLink: () => void;
  copied: boolean;
}) {
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) uploader.add(e.target.files);
    e.target.value = "";
  };
  const accept = dumpster.settings.allowVideo ? "image/*,video/*" : "image/*";

  return (
    <section className="space-y-4 p-4">
      <label className="flex min-h-[42dvh] cursor-pointer flex-col justify-between border-3 border-ink bg-green p-5 active:translate-x-[2px] active:translate-y-[2px]">
        <span className="label">Tap to drop · photos{dumpster.settings.allowVideo ? " + videos" : ""}</span>
        <span className="display text-[clamp(3.75rem,19vw,6.5rem)]">
          Throw
          <br />
          it in.
        </span>
        <span className="label">No login · {dumpster.ttlHours}h then it’s all gone</span>
        <input type="file" multiple accept={accept} onChange={pick} className="sr-only" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="btn cursor-pointer">
          Camera
          <input type="file" accept="image/*" capture="environment" onChange={pick} className="sr-only" />
        </label>
        {dumpster.settings.allowVideo ? (
          <label className="btn btn-ghost cursor-pointer">
            Video
            <input type="file" accept="video/*" capture="environment" onChange={pick} className="sr-only" />
          </label>
        ) : (
          <span className="btn btn-ghost opacity-40">No video</span>
        )}
      </div>

      {uploader.items.length > 0 && (
        <ul className="border-3 border-ink">
          {uploader.items.map((u, i) => (
            <li key={u.id} className={`flex items-center gap-3 p-2 ${i ? "border-t border-ink" : ""}`}>
              <div className="grid size-12 shrink-0 place-items-center overflow-hidden border-2 border-ink bg-bone">
                {u.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.preview} alt="" className="size-full object-cover" />
                ) : (
                  <span className="label">{u.kind === "video" ? "VID" : "IMG"}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`label truncate ${u.state === "waiting" || u.state === "failed" ? "text-fire" : ""}`}>
                  {u.state === "failed" ? u.error : STATUS[u.state]}
                  {u.state === "uploading" ? ` ${Math.round(u.progress * 100)}%` : ""}
                </p>
                <div className="mt-1 h-2 border border-ink">
                  <div
                    className={`h-full ${u.state === "failed" ? "bg-fire" : u.state === "processing" ? "animate-pulse bg-green" : "bg-green"}`}
                    style={{ width: `${u.state === "processing" ? 100 : u.progress * 100}%` }}
                  />
                </div>
              </div>
              {u.state === "failed" && (
                <button onClick={() => uploader.dismiss(u.id)} className="display px-2 text-xl" aria-label="Dismiss">
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Share id={dumpster.id} onCopyLink={onCopyLink} copied={copied} />
    </section>
  );
}

function Share({ id, onCopyLink, copied }: { id: string; onCopyLink: () => void; copied: boolean }) {
  return (
    <div className="border-3 border-ink">
      <p className="label border-b border-ink bg-ink px-3 py-1 text-paper">Get everyone in</p>
      <div className="grid grid-cols-[120px_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/dumpsters/${id}/qr`} alt="QR code for this Dumpster" className="size-[120px] border-r-3 border-ink" />
        <div className="flex min-w-0 flex-col justify-between gap-2 p-3">
          <button className="btn btn-green w-full !py-3" onClick={onCopyLink}>
            {copied ? "Copied!" : "Copy Dumpster link"}
          </button>
          <a className="btn btn-ghost w-full !py-2 !text-sm" href={`/${id}/stage`} target="_blank" rel="noreferrer">
            Big-screen view
          </a>
        </div>
      </div>
    </div>
  );
}
