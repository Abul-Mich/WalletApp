// One color per category, shared by Statistics and the spend form so a category
// looks the same everywhere. Colors come from the --viz-* palette; categories are
// ordered by name, then the built-in groups. More than 8 falls back to --viz-other.
export const SERIES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)", "var(--viz-7)", "var(--viz-8)"];
export const EXTRA_CATEGORIES = ["Card spending", "Common expenses", "Uncategorized"];

export function makeColorFor(categories) {
  const order = [...categories.map((c) => c.name).sort((a, b) => a.localeCompare(b)), ...EXTRA_CATEGORIES];
  return (name) => {
    const i = order.indexOf(name);
    return i >= 0 && i < SERIES.length ? SERIES[i] : "var(--viz-other)";
  };
}
