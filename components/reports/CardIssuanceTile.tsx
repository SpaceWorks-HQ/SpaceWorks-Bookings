import type { CardIssuance } from "@/lib/reports/cards";
import { ChartFrame } from "./charts/ChartFrame";
import { ColumnChart } from "./charts/ColumnChart";
import { KpiTile } from "./charts/Figures";

/** B11 card issuance. Hidden until lib/reports/cards.ts returns data (P6). */
export function CardIssuanceTile({ cards }: { cards: CardIssuance }) {
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-3">
      <h2 id="cards-title" className="text-h4 text-ink">Member cards</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
        <KpiTile label="Issued" value={cards.issued} />
        <KpiTile label="Reissued" value={cards.reissued} hint="Printed details changed" />
        <KpiTile label="Revoked" value={cards.revoked} />
        <KpiTile label="Active without a card" value={cards.missing} />
      </div>
      {cards.byDay?.length ? (
        <ChartFrame title="Cards issued" table={{ columns: ["Day", "Issued"], rows: cards.byDay.map((d) => [d.label, d.issued]) }}>
          <ColumnChart ariaLabel="Cards issued per day" labels={cards.byDay.map((d) => d.label)} series={[{ key: "issued", label: "Issued", slot: 1, values: cards.byDay.map((d) => d.issued) }]} />
        </ChartFrame>
      ) : null}
    </section>
  );
}
