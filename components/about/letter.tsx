import { SpaceWorksLogo } from "@/components/brand/SpaceWorksLogo";

/** The team's note on the About page (components/about/BuildingNote.tsx). */
export const LETTER = {
  overline: "A note from Space Works",
  title: "Book the room. Get back to making.",
  intro: [
    "Space Works started as a room with workbenches and a kettle. Soon the room had a waiting list: a class on Saturday, a meet-up on Tuesday, someone who needed the big table for a week. The bookings lived in a chat group, a shared calendar and a folder of UPI screenshots.",
    "Every makerspace we knew ran the same way. Two groups turned up for the same slot, deposits were tracked by memory, and refunds were worked out on the back of an envelope.",
    "So we built Space Works Bookings, one calm place for every room, studio, desk and hall, and we run our own makerspace on it first.",
  ],
  list: [
    "Spaces with their own hours, rates and rules",
    "Free or paid, instant or approved, with deposits and pay later",
    "Online and offline payments with GST-correct receipts",
    "Refunds that follow your policy, with a credit note every time",
    "A day sheet the front desk can read at a glance",
  ],
  outro: [
    "It is open source under the AGPL, so any makerspace can read the code, run its own copy and keep its bookings on its own server.",
    "If you look after a shared space, for a living or for love, we hope it gives you your evenings back.",
  ],
  closing: ["Fewer double bookings.", "More making.", "See you at the workbench."],
  signature: "Shaan Shoukath",
  team: [{ name: "Shaan Shoukath", role: "Systems Engineer, Space Works" }],
} as const;

/* Materials: paper stays paper in both colour modes. */
export const PAPER = "var(--sw-brand-warm-cream)";
export const INK = "var(--sw-brand-deep-ink)";
export const PAPER_LINE = "rgb(20 44 42 / 0.14)";
export const HAIRLINE = "rgb(20 44 42 / 0.18)";

export function Lines({ count }: { count: number }) {
  return (
    <span className="flex flex-col gap-[11px]">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="block h-[2px] rounded-full" style={{ background: PAPER_LINE, width: index === count - 1 ? "58%" : "100%" }} />
      ))}
    </span>
  );
}

/** The opened letter, to read. It settles in once (a plain fade under reduced motion). */
export function ReadingLetter() {
  return (
    <article
      className="sw-note-letter relative mx-4 max-h-[calc(100dvh-32px)] w-full max-w-[640px] overflow-y-auto rounded-[6px] shadow-float"
      style={{ background: PAPER, color: INK }}
    >
      <div className="px-6 py-10 sm:px-12 sm:py-14">
        <header className="flex items-start justify-between gap-4 border-b pb-6" style={{ borderColor: PAPER_LINE }}>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] opacity-60">{LETTER.overline}</p>
            <h2 className="mt-2 font-accent text-[26px] font-medium leading-[1.15] sm:text-[32px]">{LETTER.title}</h2>
          </div>
          <SpaceWorksLogo variant="symbol" height={48} adaptive={false} label={null} className="mt-1" />
        </header>

        <div className="mt-7 flex flex-col gap-4 text-[17px] leading-[1.7] sm:text-[18px]">
          {LETTER.intro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <ul className="my-1 flex flex-col gap-1.5 border-l-2 pl-5" style={{ borderColor: "var(--sw-brand-maker-teal)" }}>
            {LETTER.list.map((entry) => <li key={entry}>{entry}</li>)}
          </ul>
          {LETTER.outro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <p className="flex flex-col gap-0.5 font-semibold">
            {LETTER.closing.map((text) => <span key={text}>{text}</span>)}
          </p>
        </div>

        <footer className="mt-10 flex flex-col gap-4">
          <p className="text-[20px] font-semibold">— {LETTER.signature}</p>
          <ul className="grid gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-2">
            {LETTER.team.map((person) => (
              <li key={person.name}>
                <span className="font-semibold">{person.name}</span>
                <span className="opacity-70">, {person.role}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] opacity-60">Space Works Bookings · open source</p>
        </footer>
      </div>
    </article>
  );
}
