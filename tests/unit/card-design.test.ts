import { describe, expect, it } from "vitest";
import { CARD_ELEMENTS, estimateEmWidth, nameSizePt } from "@/lib/cards/design/elements";
import { isDefaultLayout, layoutForPaper } from "@/lib/cards/design/geometry";
import { normalizeCardSide } from "@/lib/cards/design/normalize";
import { applyCardPreset, CARD_PRESETS, defaultCardDesign, normalizeCardDesign } from "@/lib/cards/design/presets";
import { resolveCardPalette, BRAND } from "@/lib/cards/palette";
import { contrastRatio } from "@/lib/theme/accent";

const context = { organisationName: "SpaceWorks", planName: "Annual member" };

describe("card designs", () => {
  it.each(CARD_PRESETS)("the %s preset keeps every item on the card", (preset) => {
    const design = defaultCardDesign(context, preset);
    for (const side of [design.front, design.back]) {
      for (const element of CARD_ELEMENTS) {
        const at = side.elementPositions[element];
        expect(at.xMm).toBeGreaterThanOrEqual(0);
        expect(at.xMm + side.elementSizes[element]).toBeLessThanOrEqual(side.widthMm + 0.01);
        expect(at.yMm).toBeLessThan(side.heightMm);
      }
    }
  });

  it("normalises anything unexpected back to safe values", () => {
    const side = normalizeCardSide({ widthMm: 9999, template: "neon", heading: "x".repeat(500), backgroundColor: "#ff0000", printFieldKeys: ["ok_key", "Bad Key", "ok_key"], elementPositions: { name: { xMm: -5, yMm: "abc" } } }, context);
    expect(side.widthMm).toBe(300);
    expect(side.template).toBe("classic");
    expect(side.heading).toHaveLength(120);
    expect(side.backgroundColor).toBe("white");
    expect(side.printFieldKeys).toEqual(["ok_key"]);
    expect(side.elementPositions.name.xMm).toBe(0);
  });

  it("round-trips a stored design and falls back for garbage", () => {
    const design = defaultCardDesign(context, "night");
    expect(normalizeCardDesign(JSON.parse(JSON.stringify(design)), context)).toEqual(design);
    expect(normalizeCardDesign("garbage", context).preset).toBe("community");
  });

  it("a preset keeps the chosen watermark and printed answers", () => {
    const design = defaultCardDesign(context);
    design.front.printFieldKeys = ["blood_group"];
    design.front.watermark = { ...design.front.watermark, kind: "text", text: "MEMBER" };
    const next = applyCardPreset(design, "student", context);
    expect(next.preset).toBe("student");
    expect(next.front.printFieldKeys).toEqual(["blood_group"]);
    expect(next.front.watermark.text).toBe("MEMBER");
  });

  it("knows an untouched layout from a hand-adjusted one", () => {
    const side = { ...defaultCardDesign(context).front };
    expect(isDefaultLayout(side)).toBe(true);
    side.elementPositions = { ...side.elementPositions, name: { xMm: 30, yMm: 30 } };
    expect(isDefaultLayout(side)).toBe(false);
    expect(layoutForPaper("bold", 54, 85.6).elementPositions.qr.yMm).toBeGreaterThan(50);
  });

  it("estimates Indic names wider than Latin ones and shrinks long names", () => {
    expect(estimateEmWidth("ശ്രീക്ഷേത്ര", false)).toBeGreaterThan(estimateEmWidth("Shaan", false));
    const side = defaultCardDesign(context).front;
    expect(nameSizePt(side, "Alexandra Montgomery-Fitzgerald Venkataraman")).toBeLessThan(side.elementTextSizes.name);
  });

  it("keeps text readable whatever colours are chosen", () => {
    for (const backgroundColor of ["white", "cream", "ink", "teal", "citron", "sky"] as const) {
      for (const textColor of ["auto", "ink", "teal", "cream", "white"] as const) {
        const palette = resolveCardPalette({ colorMode: "colour", backgroundColor, accentColor: "orange", textColor }, BRAND.orange);
        expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
