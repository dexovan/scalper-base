// ============================================================
// PRICE FORMATTER - Bybit-style decimal precision
// Automatically formats prices with correct decimal places
// ============================================================

/**
 * Determines correct decimal places based on price magnitude
 * Matches Bybit's display standards
 */
export function getPrecisionForPrice(price) {
  if (!price || price === 0) return 2;

  const absPrice = Math.abs(price);

  // High-value assets (BTC, ETH range)
  if (absPrice >= 1000) return 2;        // $10,000+ → 12345.67
  if (absPrice >= 100) return 2;         // $100-999 → 123.45
  if (absPrice >= 10) return 3;          // $10-99 → 12.345
  if (absPrice >= 1) return 4;           // $1-9 → 1.2345

  // Mid-range altcoins
  if (absPrice >= 0.1) return 4;         // $0.1-0.99 → 0.1234
  if (absPrice >= 0.01) return 5;        // $0.01-0.099 → 0.01234
  if (absPrice >= 0.001) return 5;       // $0.001-0.009 → 0.00123

  // Micro-cap altcoins
  if (absPrice >= 0.0001) return 6;      // $0.0001-0.0009 → 0.000123
  if (absPrice >= 0.00001) return 7;     // $0.00001-0.00009 → 0.0000123
  if (absPrice >= 0.000001) return 8;    // $0.000001-0.000009 → 0.00000123

  // Ultra low-cap (meme coins)
  return 10;                              // < $0.000001 → 0.0000000123
}

/**
 * Formats price with correct Bybit-style precision
 */
export function formatPrice(price) {
  if (price === null || price === undefined) return 'N/A';

  const precision = getPrecisionForPrice(price);
  return parseFloat(price.toFixed(precision));
}

/**
 * Formats price as string with trailing zeros (for display)
 */
export function formatPriceString(price) {
  if (price === null || price === undefined) return 'N/A';

  const precision = getPrecisionForPrice(price);
  return price.toFixed(precision);
}

/**
 * Formats entry zone with consistent precision
 */
export function formatEntryZone(entryZone) {
  if (!entryZone) return null;

  const precision = getPrecisionForPrice(entryZone.ideal);

  return {
    min: parseFloat(entryZone.min.toFixed(precision)),
    ideal: parseFloat(entryZone.ideal.toFixed(precision)),
    max: parseFloat(entryZone.max.toFixed(precision))
  };
}

/**
 * Formats entry zone as display string
 */
export function formatEntryZoneDisplay(entryZone) {
  if (!entryZone) return 'N/A';

  const precision = getPrecisionForPrice(entryZone.ideal);
  const spread = Math.abs((entryZone.max - entryZone.min) / entryZone.ideal * 100);

  return `[${entryZone.min.toFixed(precision)} — ${entryZone.ideal.toFixed(precision)} — ${entryZone.max.toFixed(precision)}] (±${spread.toFixed(3)}%)`;
}

export default {
  getPrecisionForPrice,
  formatPrice,
  formatPriceString,
  formatEntryZone,
  formatEntryZoneDisplay
};
