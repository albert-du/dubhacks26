"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** Selfie for sign-in: snap one with the front camera, or upload a photo of yourself. */
export function SelfiePicker({ value, onChange }: { value: Blob | null; onChange: (b: Blob | null) => void }) {
  const [camera, setCamera] = useState(false);
  const url = useMemo(() => (value ? URL.createObjectURL(value) : ""), [value]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  if (camera)
    return (
      <div className="border-3 border-ink">
        <Camera
          onShot={(b) => {
            onChange(b);
            setCamera(false);
          }}
          onCancel={() => setCamera(false)}
        />
      </div>
    );

  if (value)
    return (
      <div className="relative border-3 border-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Your selfie" className="block aspect-square w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 grid grid-cols-2 gap-2 p-2">
          <button type="button" className="btn !py-2" onClick={() => setCamera(true)}>
            Retake
          </button>
          <UploadButton onFile={onChange} className="btn btn-ghost !bg-paper !py-2">
            Upload
          </UploadButton>
        </div>
      </div>
    );

  return (
    <div className="grid grid-cols-2 border-3 border-ink">
      <button type="button" onClick={() => setCamera(true)} className="grid aspect-square place-items-center bg-bone">
        <span className="text-center">
          <span className="display block text-3xl">Selfie</span>
          <span className="label">Take one</span>
        </span>
      </button>
      <UploadButton onFile={onChange} className="grid aspect-square cursor-pointer place-items-center border-l-3 border-ink">
        <span className="text-center">
          <span className="display block text-3xl">Photo</span>
          <span className="label">Upload one</span>
        </span>
      </UploadButton>
    </div>
  );
}

function UploadButton({ onFile, className, children }: { onFile: (f: File) => void; className: string; children: React.ReactNode }) {
  return (
    <label className={className}>
      {children}
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

function Camera({ onShot, onCancel }: { onShot: (b: Blob) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("Camera blocked. Allow it in your browser settings."));
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const snap = () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onShot(b), "image/jpeg", 0.9);
  };

  if (error)
    return (
      <div className="p-4">
        <p className="mb-3">{error}</p>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    );

  return (
    <div className="relative bg-ink">
      <video ref={video} autoPlay playsInline muted className="block aspect-square w-full -scale-x-100 object-cover" />
      <div className="pointer-events-none absolute inset-[18%] border-3 border-dashed border-green" />
      <div className="absolute inset-x-0 bottom-0 grid grid-cols-[1fr_2fr] gap-2 p-2">
        <button type="button" className="btn btn-ghost !text-paper" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-green" onClick={snap}>
          Snap
        </button>
      </div>
    </div>
  );
}
