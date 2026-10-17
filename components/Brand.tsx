import Link from "next/link";

/** Green can on an ink block — the app's corner mark. Assets come from `npm run brand`. */
export function MarkBlock({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="Dump home" className={`grid shrink-0 place-items-center bg-ink px-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mark-green.webp" alt="" width={21} height={36} className="h-9 w-auto" />
    </Link>
  );
}

/** Full logo with wordmark. */
export function Logo({ tone = "ink", className = "" }: { tone?: "ink" | "green"; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/brand/logo-${tone}.webp`} alt="Dump" width={293} height={600} className={`w-auto ${className}`} />
  );
}

/** The flaming can used for the Dumpster Fire reaction. */
export function FireIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/fire.webp" alt="" width={Math.round(size * 0.494)} height={size} style={{ height: size, width: "auto" }} className={className} />
  );
}
