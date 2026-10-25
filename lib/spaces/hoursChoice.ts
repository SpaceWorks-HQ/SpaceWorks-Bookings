export const EMPTY_HOURS_MESSAGE = "Add opening hours for at least one day. A makerspace with no hours set is treated as open all day, every day.";

export function hoursChoiceError(spaceId: string | null, hours: readonly unknown[], openAllDay = false) {
  return !spaceId && !hours.length && !openAllDay ? EMPTY_HOURS_MESSAGE : null;
}
