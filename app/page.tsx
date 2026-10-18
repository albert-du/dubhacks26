import { Logo, MarkBlock } from "@/components/Brand";
import { CreateForm } from "@/components/CreateForm";
import { StartByMessage } from "@/components/StartByMessage";

const STEPS = [
  ["Pass it around", "Tape the code to the cooler or text the link to the group chat. Anyone who has it can get in."],
  ["Throw it all in", "Everybody drops what they shot, blurry ones included. On bad signal, photos wait on the phone and go once it’s back."],
  ["Find yourself", "Sign in with your name and a quick selfie, and every shot you’re in pulls up. Add a number to get a text when you land in new ones. Next time, your name is enough."],
  ["Start fires", "Hit the burning can on the best disasters. Most fires tops the board. Cut stickers out of the winners."],
  ["Watch it burn", "When the timer hits zero, every photo, video and name goes with it."],
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[430px]">
      <header className="flex h-14 items-stretch border-b-3 border-ink">
        <MarkBlock divider={false} />
      </header>

      <section className="grid grid-cols-[1fr_auto] items-end gap-3 px-4 pt-6 pb-8">
        <h1 className="display min-w-0 text-[clamp(3.2rem,16vw,5rem)]">
          Throw
          <br />
          every
          <br />
          <span className="hl bg-green">photo</span>
          <br />
          in.
        </h1>
        <Logo className="h-32 self-start justify-self-end" />
        <p className="col-span-2 mt-4 text-[15px] leading-snug">
          One shared pile for the party, the hike, the wedding, the tailgate. Everyone adds what they shot, everyone finds
          themselves in it, and a day or three later it burns.
        </p>
      </section>

      <section className="border-t-3 border-ink px-4 py-6">
        <h2 className="display mb-4 text-3xl">Start a Dumpster</h2>
        <CreateForm />
        <p className="mt-3 text-xs leading-snug">You’ll sign in to it next, like everyone you invite: your name, a quick selfie, and a number if you want texts.</p>
      </section>

      <section className="border-t-3 border-ink px-4 py-6">
        <h2 className="display mb-4 text-2xl">Or start by iMessage</h2>
        <StartByMessage />
      </section>

      <section className="border-t-3 border-ink">
        <h2 className="display px-4 pt-6 pb-2 text-3xl">How it goes</h2>
        <ol>
          {STEPS.map(([title, body], i) => (
            <li key={title} className="grid grid-cols-[3.25rem_1fr] border-t border-ink">
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
        <p className="label bg-ink px-2 py-1.5 text-paper">Nothing here is forever. That’s the point.</p>
      </footer>
    </div>
  );
}
