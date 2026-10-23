/**
 * Unit allocation for identical units (hot desks). Lowest free unit first; the same units across a series where
 * possible, so a recurring desk booking keeps "desk 3". Pure: the caller holds the space's advisory lock and passes
 * each slot's free units (null for a slot that can't be booked).
 */

export function allocateUnits(slotFree: Array<number[] | null>, quantity: number, prefer: Array<number[] | null> = []): Array<number[] | null> {
  const usable = slotFree.filter((free): free is number[] => free !== null);
  const common = usable.length ? usable.reduce((shared, free) => shared.filter((unit) => free.includes(unit))) : [];
  return slotFree.map((free, index) => {
    if (!free || free.length < quantity) return null;
    const preferred = (prefer[index] ?? []).filter((unit) => free.includes(unit));
    const order = [...new Set([...preferred, ...[...common].sort((a, b) => a - b), ...[...free].sort((a, b) => a - b)])];
    return order.slice(0, quantity).sort((a, b) => a - b);
  });
}

/** Pairs of slots in one request that overlap each other (their blocks, buffers included). */
export function overlappingSlots(blocks: Array<{ start: number; end: number }>): Set<number> {
  const clash = new Set<number>();
  for (let later = 1; later < blocks.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      if (blocks[earlier].start < blocks[later].end && blocks[earlier].end > blocks[later].start) clash.add(later);
    }
  }
  return clash;
}
