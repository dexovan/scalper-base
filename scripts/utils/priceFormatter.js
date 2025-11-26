// ============================================================
// PRICE FORMATTER - Bybit TickSize Accurate Version
// Formats all prices EXACTLY per Bybit market specifications
// ============================================================

/**
 * Calculates number of decimals from tickSize
 * Example:
 * tickSize = 0.0001 → returns 4
 * tickSize = 0.1     → returns 1
 */
export function getDecimalsFromTickSize(tickSize) {
  const s = tickSize.toString();
  const dot = s.indexOf('.');
  if (dot === -1) return 0;
  return s.length - dot - 1;
}

/**
 * Rounds price to valid Bybit tickSize
 */
export function roundPriceToTick(price, tickSize) {
  return Math.round(price / tickSize) * tickSize;
}

/**
 * Formats price EXACTLY how Bybit expects it:
 * - properly rounded to tickSize
 * - returned as string with correct decimal places
 */
export function formatPriceByTick(price, tickSize) {
  if (price === null || price === undefined) return 'N/A';
  if (!tickSize) return String(price);

  const decimals = getDecimalsFromTickSize(tickSize);
  const rounded = roundPriceToTick(price, tickSize);
  return rounded.toFixed(decimals);   // STRING → ideal for JSON body
}

/**
 * Formats price for internal numeric usage
 * Rounded to tick size, returned as number
 */
export function formatPriceNumber(price, tickSize) {
  if (price === null || price === undefined) return null;
  if (!tickSize) return Number(price);

  const decimals = getDecimalsFromTickSize(tickSize);
  const rounded = roundPriceToTick(price, tickSize);
  return Number(rounded.toFixed(decimals));
}

/**
 * Formats entire entry zone
 */
export function formatEntryZone(entryZone, tickSize) {
  if (!entryZone) return null;

  return {
    min: formatPriceNumber(entryZone.min, tickSize),
    ideal: formatPriceNumber(entryZone.ideal, tickSize),
    max: formatPriceNumber(entryZone.max, tickSize),
  };
}

/**
 * Display version with nice formatting
 */
export function formatEntryZoneDisplay(entryZone, tickSize) {
  if (!entryZone) return 'N/A';

  const min = formatPriceByTick(entryZone.min, tickSize);
  const ideal = formatPriceByTick(entryZone.ideal, tickSize);
  const max = formatPriceByTick(entryZone.max, tickSize);

  const spread = Math.abs(
    ((entryZone.max - entryZone.min) / entryZone.ideal) * 100
  ).toFixed(3);

  return `[${min} — ${ideal} — ${max}] (±${spread}%)`;
}

export default {
  getDecimalsFromTickSize,
  roundPriceToTick,
  formatPriceByTick,
  formatPriceNumber,
  formatEntryZone,
  formatEntryZoneDisplay
};
