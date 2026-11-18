import Decimal from "./vendor/decimal.mjs";

const DIVISION_DECIMAL_PLACES = 113;
const DecimalNumber = Decimal.clone({
  precision: 1000,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -1000,
  toExpPos: 1000,
});
const IntegerDecimal = Decimal.clone({
  precision: 10000,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -10000,
  toExpPos: 10000,
});

const BigNum = (value) => new DecimalNumber(value);
const NUMBER_LOCALE_STRING = "1,234,567.89";

const groupMatcher = (grouping) => new RegExp(
  `(?<!\\.\\d+)(?<=\\d)(?=(?:\\d{${grouping}})*\\d{${grouping ? 3 : 0}}(?:\\.|$))`,
  "g",
);

const locale = {
  thousandSeperator: ",",
  decimalSeperator: ".",
  grouping: 3,
  decimalDigits: 2,
  groupMatcher: groupMatcher(3),
  formatString: NUMBER_LOCALE_STRING,
  numeralMatcher: /-?(?:(?:\d+,?)+(\.\d*)?|(\.\d+))/y,
};

DecimalNumber.prototype.toLocaleString = function toLocaleString(
  decimalDigits = locale.decimalDigits,
) {
  decimalDigits = Math.max(locale.decimalDigits, decimalDigits);
  const value = this.toFixed(decimalDigits, Decimal.ROUND_HALF_UP);
  const splitValue = value.split(locale.groupMatcher);
  const last = splitValue.length - 1;
  splitValue[last] = splitValue[last].replace(".", locale.decimalSeperator);
  return splitValue.join(locale.thousandSeperator);
};

DecimalNumber.prototype.toFixedDecimal = function toFixedDecimal(
  decimalDigits = locale.decimalDigits,
) {
  return this.toFixed(decimalDigits, Decimal.ROUND_HALF_UP);
};

DecimalNumber.prototype.canTrimZeros = function canTrimZeros(decimalDigits) {
  return new DecimalNumber(this.toFixedDecimal(decimalDigits)).equals(
    new DecimalNumber(this.toFixedDecimal()),
  );
};

BigNum.parseString = (string) => {
  const ungrouped = locale.thousandSeperator
    ? string.replaceAll(locale.thousandSeperator, "")
    : string;
  return new DecimalNumber(ungrouped.replace(locale.decimalSeperator, "."));
};

function integerGcd(left, right) {
  let x = left.abs();
  let y = right.abs();
  while (!y.isZero()) {
    [x, y] = [y, x.mod(y)];
  }
  return x;
}

function hasTerminatingQuotient(left, right) {
  const [leftNumerator, leftDenominator] = left.toFraction();
  const [rightNumerator, rightDenominator] = right.toFraction();
  const numerator = new IntegerDecimal(leftNumerator.toString())
    .times(rightDenominator.toString());
  let denominator = new IntegerDecimal(leftDenominator.toString())
    .times(rightNumerator.toString())
    .abs();
  denominator = denominator.div(integerGcd(numerator, denominator));
  for (const factor of [2, 5]) {
    while (denominator.mod(factor).isZero()) denominator = denominator.div(factor);
  }
  return denominator.equals(1);
}

BigNum.divideExact = (left, right) => {
  if (right.isZero()) throw new RangeError("division by zero");
  if (!hasTerminatingQuotient(left, right)) {
    throw new RangeError("cannot convert to a BigDecimal");
  }
  return left.div(right);
};

BigNum.divide = (left, right) => {
  if (right.isZero()) throw new RangeError("division by zero");
  return left.div(right).toDecimalPlaces(
    DIVISION_DECIMAL_PLACES,
    Decimal.ROUND_HALF_EVEN,
  );
};

BigNum.power = (left, right) => {
  if (!right.isInteger() || right.isNegative()) throw new RangeError("invalid operation");
  return left.pow(right);
};

const BigNumEnv = {
  prec: DIVISION_DECIMAL_PLACES,
  initLocale(format = NUMBER_LOCALE_STRING) {
    const next = this.getLocale(format);
    if (next) Object.assign(locale, next);
    return locale;
  },
  getLocale(format) {
    const match = /^\d{1,2}[^\d]?(\d{2,3})([^\d])?\d{3}([^\d])(\d+)$/m.exec(format);
    if (!match) return null;
    const [, grouping, thousandSeperator, decimalSeperator, decimalDigits] = match;
    const next = {
      grouping: thousandSeperator ? grouping.length : 0,
      thousandSeperator: thousandSeperator ?? "",
      decimalSeperator,
      decimalDigits: decimalDigits.length,
      formatString: format,
    };
    next.groupMatcher = groupMatcher(next.grouping);
    next.numeralMatcher = next.thousandSeperator === ""
      ? new RegExp(`-?(?:(?:\\d+)+(\\${next.decimalSeperator}\\d*)?|(\\${next.decimalSeperator}\\d+))`, "y")
      : new RegExp(`-?(?:(?:\\d+\\${next.thousandSeperator}?)+(\\${next.decimalSeperator}\\d*)?|(\\${next.decimalSeperator}\\d+))`, "y");
    return next;
  },
  getNumeralMatcher: () => locale.numeralMatcher,
  setDecimalDigits: (digits) => { locale.decimalDigits = digits; },
  getDecimalDigits: () => locale.decimalDigits,
  getLocaleFormat: () => locale.formatString ?? null,
};

export {
  BigNum,
  BigNumEnv,
  DecimalNumber,
  DIVISION_DECIMAL_PLACES,
  locale,
  NUMBER_LOCALE_STRING,
};
