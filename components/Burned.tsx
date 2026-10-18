import Link from "next/link";
import { Logo } from "./Brand";

export function Burned() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <div className="hazard h-6" />
      <main className="flex flex-1 flex-col justify-center px-4">
        <Logo className="mb-6 h-28 opacity-30 grayscale" />
        <h1 className="display text-[clamp(3rem,15vw,5rem)]">
          This
          <br />
          Dumpster
          <br />
          <span className="hl bg-fire">burned</span>
          <br />
          down.
        </h1>
        <p className="mt-6 max-w-sm">Every photo, video, name and number that was in it is gone. That was the deal.</p>
        <Link href="/" className="btn btn-green mt-8 self-start">
          Start a new one →
        </Link>
      </main>
      <div className="hazard h-6" />
    </div>
  );
}
