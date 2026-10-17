import { Logo, MarkBlock } from "@/components/Brand";
import { CreateForm } from "@/components/CreateForm";

const STEPS = [
  ["Scan", "Stick the QR on the cooler. Guests open a link — no app, no account."],
  ["Drop", "Everyone throws raw photos and videos into one pool. Works on bad signal; uploads wait on the phone until they can go."],
  ["Find yourself", "Take a 1-second selfie and every shot of you surfaces. Get a text when new ones land."],
  ["Rank the fires", "The AI flags candid chaos. The group votes on the best disasters. Cut stickers from the winners."],
  ["It burns", "24, 48 or 72 hours later every photo, face vector and phone number is deleted. Not archived. Deleted."],
];

export default function Home() {
  const photon = process.env.NEXT_PUBLIC_PHOTON_NUMBER;
  return (
    <div className="mx-auto max-w-xl">
      <header className="flex items-stretch border-b-3 border-ink">
        <MarkBlock />
        <span className="label flex flex-1 items-center justify-end px-3">dumpster.photo</span>
      </header>

      <section className="px-4 pt-6 pb-8">
        <Logo className="mb-6 h-40" />
        <h1 className="display text-[clamp(4rem,22vw,8.5rem)]">
          Throw
          <br />
          every
          <br />
          <span className="bg-green px-1">photo</span>
          <br />
          in.
        </h1>
        <p className="mt-6 max-w-sm text-[15px] leading-snug">
          One shared, self-destructing pool for the party, the hike, the wedding, the tailgate. No logins. Faces found.
          Gone in 72 hours.
        </p>
      </section>

      <section className="border-t-3 border-ink px-4 py-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="display text-3xl">Open a Dumpster</h2>
          <span className="label">01</span>
        </div>
        <CreateForm />
        {photon && (
          <div className="mt-6 border-3 border-dashed border-ink p-4">
            <p className="label mb-2">Or text the Dumpster agent</p>
            <p className="display text-lg leading-tight">CREATE DUMPSTER “MT. SI HIKE” 48H</p>
            <p className="mt-1 text-sm">
              to <a className="underline decoration-2" href={`sms:${photon}`}>{photon}</a>
            </p>
          </div>
        )}
      </section>

      <section className="border-t-3 border-ink">
        <h2 className="display px-4 pt-6 pb-2 text-3xl">How it works</h2>
        <ol>
          {STEPS.map(([title, body], i) => (
            <li key={title} className="grid grid-cols-[3.5rem_1fr] border-t border-ink">
              <span className="display border-r border-ink pt-3 text-center text-2xl">{String(i + 1).padStart(2, "0")}</span>
              <div className="p-3">
                <h3 className="display text-xl">{title}</h3>
                <p className="text-sm leading-snug">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="hazard mt-6 p-3">
        <p className="label inline bg-ink px-2 py-1 text-paper">Nothing here is forever. That’s the point.</p>
      </footer>
    </div>
  );
}
