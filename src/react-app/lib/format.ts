const SIZE_UNITS: readonly [string, number][] = [
  ["megabyte", 1024 ** 2],
  ["kilobyte", 1024],
  ["byte", 1],
];

/**
 * Describes a size in bytes in the largest unit that keeps it above 1, for example "1.4 kB".
 * @param bytes - The size in bytes.
 * @returns The size in the visitor's language.
 */
export const formatSize = (bytes: number): string => {
  const [unit, size] =
    SIZE_UNITS.find(([, limit]) => bytes >= limit) ?? SIZE_UNITS[2];
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit,
    unitDisplay: "narrow",
    maximumFractionDigits: 1,
  }).format(bytes / size);
};

/**
 * Writes a count with its noun, for example "1 webhook" or "3 webhooks".
 * @param count - The number of things.
 * @param singular - The noun for exactly one.
 * @param plural - The noun for any other count; defaults to the singular with an `s`.
 */
export const countOf = (
  count: number,
  singular: string,
  plural = `${singular}s`,
): string => `${count} ${count === 1 ? singular : plural}`;
