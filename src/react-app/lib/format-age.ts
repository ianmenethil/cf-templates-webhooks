const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

/** Formats a timestamp as a full date and time, for tooltips. */
export const absoluteTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const STEPS: readonly [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.35, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

/**
 * Describes how long ago a timestamp was, for example "3 hours ago".
 * @param iso - An ISO 8601 timestamp.
 * @returns The age in the visitor's language.
 */
export const formatAge = (iso: string): string => {
  let value = (new Date(iso).getTime() - Date.now()) / 1000;
  // The last step's size is infinite, so the loop always returns there.
  for (let i = 0; ; i++) {
    const [size, unit] = STEPS[i];
    if (Math.abs(value) < size) {
      return relativeTime.format(Math.round(value), unit);
    }
    value /= size;
  }
};
