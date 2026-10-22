import "server-only";

/*
 * One bulk card render at a time per server process, across every bulk
 * job and route: a full batch takes real memory and a
 * 512 MB instance must not build two at once. The flag lives on globalThis so
 * every route bundle shares the same slot.
 */

const SLOT = Symbol.for("swo.cardRenderSlot");
type SlotHolder = typeof globalThis & { [SLOT]?: boolean };

/** Take the slot, or null when another bulk render holds it. Call the returned release in `finally`. */
export function tryAcquireRenderSlot(): (() => void) | null {
  const holder = globalThis as SlotHolder;
  if (holder[SLOT]) return null;
  holder[SLOT] = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holder[SLOT] = false;
  };
}
