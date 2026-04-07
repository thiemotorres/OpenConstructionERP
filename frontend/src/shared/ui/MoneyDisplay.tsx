import clsx from 'clsx';
import { usePreferencesStore } from '../../stores/usePreferencesStore';

export interface MoneyDisplayProps {
  amount: number | string | null | undefined;
  currency?: string;
  compact?: boolean;
  showCode?: boolean;
  className?: string;
  colorize?: boolean;
}

/**
 * Locale-aware monetary value display.
 *
 * Uses the user's preferred locale and currency from the preferences store.
 * Supports compact notation (e.g. 1.2M), currency code suffix, and
 * colorized output (green/red) for positive/negative values.
 */
export function MoneyDisplay({
  amount,
  currency,
  compact = false,
  showCode = false,
  className,
  colorize = false,
}: MoneyDisplayProps) {
  const { currency: defaultCurrency, numberLocale } = usePreferencesStore();

  if (amount == null) {
    return <span className={clsx('text-content-tertiary', className)}>&mdash;</span>;
  }

  const numericValue = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (Number.isNaN(numericValue)) {
    return <span className={clsx('text-content-tertiary', className)}>&mdash;</span>;
  }

  const resolvedCurrency = currency ?? defaultCurrency;
  const safeCurrency = /^[A-Z]{3}$/.test(resolvedCurrency) ? resolvedCurrency : 'EUR';

  let formatted: string;
  try {
    if (showCode) {
      // Format number without currency, then append ISO code
      const numFmt = new Intl.NumberFormat(numberLocale, {
        minimumFractionDigits: compact ? 0 : 2,
        maximumFractionDigits: 2,
        ...(compact ? { notation: 'compact' as const, maximumFractionDigits: 1 } : {}),
      });
      formatted = `${numFmt.format(numericValue)} ${safeCurrency}`;
    } else {
      const opts: Intl.NumberFormatOptions = {
        style: 'currency',
        currency: safeCurrency,
        minimumFractionDigits: compact ? 0 : 2,
        maximumFractionDigits: 2,
      };
      if (compact) {
        opts.notation = 'compact';
        opts.maximumFractionDigits = 1;
      }
      formatted = new Intl.NumberFormat(numberLocale, opts).format(numericValue);
    }
  } catch {
    formatted = `${numericValue.toFixed(2)} ${safeCurrency}`;
  }

  const colorClass = colorize
    ? numericValue > 0
      ? 'text-semantic-success'
      : numericValue < 0
        ? 'text-semantic-error'
        : ''
    : '';

  return <span className={clsx(colorClass, className)}>{formatted}</span>;
}
