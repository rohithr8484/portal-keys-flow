/**
 * Convert browser/DB numeric values like `2e-7` into fixed-point decimal
 * strings before showing them or passing them to ethers.parseUnits.
 */
export function expandScientificAmount(value: string | number): string {
  const raw = String(value).trim();
  if (!raw) return "0";
  if (!/e/i.test(raw)) return raw;

  const [coefficient, exponentText] = raw.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent)) throw new Error(`Invalid amount: ${raw}`);

  const sign = coefficient.startsWith("-") ? "-" : "";
  const unsigned = coefficient.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const decimalPlaces = fraction.length - exponent;

  if (decimalPlaces <= 0) {
    return `${sign}${digits}${"0".repeat(Math.abs(decimalPlaces))}`;
  }

  const padded = digits.padStart(decimalPlaces + 1, "0");
  const integerPart = padded.slice(0, -decimalPlaces) || "0";
  const fractionPart = padded.slice(-decimalPlaces).replace(/0+$/, "");

  return `${sign}${integerPart}${fractionPart ? `.${fractionPart}` : ""}`;
}

export function formatDisplayAmount(value: string | number): string {
  const expanded = expandScientificAmount(value);
  if (!expanded.includes(".")) return expanded;
  return expanded.replace(/0+$/, "").replace(/\.$/, "") || "0";
}

export function amountForTokenUnits(value: string | number, decimals: number): string {
  const expanded = formatDisplayAmount(value);
  const [, fraction = ""] = expanded.split(".");

  if (fraction.length > decimals) {
    throw new Error(`Amount is below this token's ${decimals}-decimal precision.`);
  }

  return expanded;
}