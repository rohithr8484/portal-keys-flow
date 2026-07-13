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

function decimalPrecisionMessage(tokenLabel: string, decimals: number): string {
  const minimum = decimals > 0 ? `0.${"0".repeat(Math.max(decimals - 1, 0))}1` : "1";
  return `${tokenLabel} supports up to ${decimals} decimal places. Enter at least ${minimum} ${tokenLabel}, or choose ETH for very small amounts.`;
}

/**
 * Convert a user-entered decimal amount into integer token units without ever
 * passing through JS Number. This prevents values like `0.0000000002` from
 * becoming `2e-10` before viem/ethers parse them.
 */
export function decimalAmountToUnits(
  value: string | number,
  decimals: number,
  tokenLabel = "token",
): bigint {
  const expanded = formatDisplayAmount(value).replace(/^\+/, "");

  if (!/^(?:\d+|\d*\.\d+)$/.test(expanded)) {
    throw new Error(`Invalid ${tokenLabel} amount.`);
  }

  const [whole = "0", fraction = ""] = expanded.split(".");
  if (fraction.length > decimals) {
    throw new Error(decimalPrecisionMessage(tokenLabel, decimals));
  }

  const wholeUnits = BigInt(whole || "0") * 10n ** BigInt(decimals);
  const fractionalUnits = BigInt((fraction || "").padEnd(decimals, "0") || "0");
  return wholeUnits + fractionalUnits;
}

export function unitsToDecimalAmount(units: bigint, decimals: number): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = absolute % base;

  if (fraction === 0n || decimals === 0) return `${sign}${whole.toString()}`;

  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  return `${sign}${whole.toString()}.${fractionText}`;
}

export function splitDecimalAmountEvenly(
  total: string | number,
  count: number,
  decimals: number,
  tokenLabel = "token",
): string[] {
  if (!Number.isInteger(count) || count <= 0) throw new Error("Add at least one recipient.");

  const totalUnits = decimalAmountToUnits(total, decimals, tokenLabel);
  if (totalUnits <= 0n) throw new Error("Enter an amount greater than zero.");

  const recipientCount = BigInt(count);
  const base = totalUnits / recipientCount;
  const remainder = totalUnits % recipientCount;

  if (base === 0n) {
    throw new Error(
      `${tokenLabel} amount is too small to split across ${count} recipients at ${decimals}-decimal precision.`,
    );
  }

  return Array.from({ length: count }, (_, index) =>
    unitsToDecimalAmount(base + (BigInt(index) < remainder ? 1n : 0n), decimals),
  );
}