/*
 * The card typeface in the browser: the same files the server renderer shapes (Gilroy Light and
 * ExtraBold, then Noto Sans for extended Latin and ₹, Noto Sans Malayalam and Devanagari), under one
 * family name with unicode ranges, so previews fall back exactly as printed cards do.
 */

export const CARD_FONT_FAMILY = "\"SWO Card\", Gilroy, system-ui, sans-serif";

const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
const MALAYALAM = "U+0307,U+0323,U+0951-0952,U+0964-0965,U+0D00-0D7F,U+1CDA,U+1CF2,U+200C-200D,U+20B9,U+25CC,U+A830-A832";
const DEVANAGARI = "U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF,U+11B00-11B09";

export function cardFontFaceCss(origin = "") {
  const face = (file: string, weight: number, range?: string) =>
    `@font-face { font-family: "SWO Card"; src: url("${origin}${file}") format("woff2"); font-weight: ${weight}; font-style: normal; font-display: block;${range ? ` unicode-range: ${range};` : ""} }`;
  return [
    face("/brand/fonts/Gilroy-Light.woff2", 400),
    face("/brand/fonts/Gilroy-ExtraBold.woff2", 700),
    ...[400, 700].flatMap((weight) => [
      face(`/fonts/noto/NotoSans-LatinExt-${weight}.woff2`, weight, LATIN_EXT),
      face(`/fonts/noto/NotoSansMalayalam-${weight}.woff2`, weight, MALAYALAM),
      face(`/fonts/noto/NotoSansDevanagari-${weight}.woff2`, weight, DEVANAGARI),
    ]),
  ].join("\n");
}

/** Include once wherever cards are drawn on screen. */
export function CardFontFaces() {
  return <style>{cardFontFaceCss()}</style>;
}
