"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4">
      <p className="label mb-3">Something jammed</p>
      <h1 className="display text-6xl">Lid’s stuck.</h1>
      <p className="mt-4">Probably the venue Wi-Fi. Your queued uploads are safe on this phone.</p>
      <button onClick={reset} className="btn mt-8 self-start">
        Try again
      </button>
    </div>
  );
}
