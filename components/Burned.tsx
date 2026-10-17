import Link from "next/link";
import { Logo } from "./Brand";

export function Burned() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <div className="hazard h-6" />
      <main className="flex flex-1 flex-col justify-center px-4">
        <Logo className="mb-6 h-28 opacity-30 grayscale" />
        <h1 className="display text-[clamp(3.5rem,17vw,7rem)]">
          This
          <br />
          Dumpster
          <br />
          <span className="bg-fire px-1">burned</span>
          <br />
          down.
        </h1>
        <p className="mt-6 max-w-sm">Every photo, video, face vector and phone number from it has been deleted. That was the deal.</p>
        <Link href="/" className="btn btn-green mt-8 self-start">
          Start a new one →
        </Link>
      </main>
      <div className="hazard h-6" />
    </div>
  );
}
