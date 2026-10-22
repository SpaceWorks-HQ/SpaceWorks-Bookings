/** Page and raster maths for card output. Pure functions, shared by routes and tests. */

export const MM_PER_INCH = 25.4;
export const PT_PER_MM = 72 / MM_PER_INCH;
export const PNG_DPI = 300;
export const A4 = { widthMm: 210, heightMm: 297 } as const;

/** Pixel size of a card rendered at `dpi` (CR80 at 300 dpi is 1011 × 638). */
export function pixelSize(widthMm: number, heightMm: number, dpi = PNG_DPI) {
  return { width: Math.round((widthMm / MM_PER_INCH) * dpi), height: Math.round((heightMm / MM_PER_INCH) * dpi) };
}

export const mmToPt = (mm: number) => mm * PT_PER_MM;

export type SheetLayout = {
  sheetWidthMm: number;
  sheetHeightMm: number;
  columns: number;
  rows: number;
  perSheet: number;
  /** Top-left corner of the first card. Cards butt together so one cut separates two cards. */
  originXMm: number;
  originYMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
};

/** Room kept around the grid for crop marks and printers' unprintable edge. */
export const SHEET_MIN_MARGIN_MM = 10;
/** Crop marks start this far from the card edge and run this long. */
export const CROP_MARK_OFFSET_MM = 2;
export const CROP_MARK_LENGTH_MM = 5;

/**
 * Lay cards out on a sheet in a centred grid with no gutters, leaving at
 * least `minMarginMm` on every side for crop marks. CR80 cards fit 2 × 5 on
 * A4 portrait. Returns at least one card per sheet even for oversized stock.
 */
export function sheetLayout(cardWidthMm: number, cardHeightMm: number, sheet: { widthMm: number; heightMm: number } = A4, minMarginMm = SHEET_MIN_MARGIN_MM): SheetLayout {
  const columns = Math.max(1, Math.floor((sheet.widthMm - 2 * minMarginMm) / cardWidthMm));
  const rows = Math.max(1, Math.floor((sheet.heightMm - 2 * minMarginMm) / cardHeightMm));
  return {
    sheetWidthMm: sheet.widthMm,
    sheetHeightMm: sheet.heightMm,
    columns,
    rows,
    perSheet: columns * rows,
    originXMm: Math.max(0, (sheet.widthMm - columns * cardWidthMm) / 2),
    originYMm: Math.max(0, (sheet.heightMm - rows * cardHeightMm) / 2),
    cardWidthMm,
    cardHeightMm,
  };
}

/** Top-left corner of the `index`-th card on its sheet, and which sheet it is on. */
export function sheetSlot(layout: SheetLayout, index: number) {
  const sheet = Math.floor(index / layout.perSheet);
  const slot = index % layout.perSheet;
  const column = slot % layout.columns;
  const row = Math.floor(slot / layout.columns);
  return { sheet, xMm: layout.originXMm + column * layout.cardWidthMm, yMm: layout.originYMm + row * layout.cardHeightMm };
}

/** Crop mark line segments (in mm, top-left origin) for every cut line of the grid. */
export function cropMarks(layout: SheetLayout) {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const left = layout.originXMm;
  const top = layout.originYMm;
  const right = left + layout.columns * layout.cardWidthMm;
  const bottom = top + layout.rows * layout.cardHeightMm;
  const offset = CROP_MARK_OFFSET_MM;
  const length = Math.min(CROP_MARK_LENGTH_MM, Math.max(0, Math.min(left, top) - offset));
  if (length <= 0) return lines;
  for (let column = 0; column <= layout.columns; column += 1) {
    const x = left + column * layout.cardWidthMm;
    lines.push({ x1: x, y1: top - offset - length, x2: x, y2: top - offset });
    lines.push({ x1: x, y1: bottom + offset, x2: x, y2: bottom + offset + length });
  }
  for (let row = 0; row <= layout.rows; row += 1) {
    const y = top + row * layout.cardHeightMm;
    lines.push({ x1: left - offset - length, y1: y, x2: left - offset, y2: y });
    lines.push({ x1: right + offset, y1: y, x2: right + offset + length, y2: y });
  }
  return lines;
}

/** Most cards one bulk export will render, to bound time and memory. */
export const BULK_CARD_LIMIT = 1000;
