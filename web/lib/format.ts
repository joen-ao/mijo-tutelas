/**
 * Formato numérico colombiano: punto para miles, coma para decimales.
 * 312500 -> "312.500", 74.3 con 1 decimal -> "74,3".
 */
export function formatEsCo(value: number, decimals = 0) {
  const parts = value.toFixed(decimals).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return parts.join(",");
}
