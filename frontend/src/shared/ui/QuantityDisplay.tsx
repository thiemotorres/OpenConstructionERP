import clsx from 'clsx';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { convertUnit, getDisplayUnit, isMetricUnit } from '../lib/unitConversion';

export interface QuantityDisplayProps {
  value: number | string | null | undefined;
  unit: string;
  precision?: number;
  className?: string;
}

/**
 * Locale-aware quantity display with automatic unit conversion.
 *
 * When the user prefers imperial and the source unit is metric (or vice versa),
 * the value is automatically converted and the unit label is updated.
 * Number formatting respects the user's locale preference.
 */
export function QuantityDisplay({
  value,
  unit,
  precision = 2,
  className,
}: QuantityDisplayProps) {
  const { measurementSystem, numberLocale } = usePreferencesStore();

  if (value == null) {
    return <span className={clsx('text-content-tertiary', className)}>&mdash;</span>;
  }

  const numericValue = typeof value === 'string' ? parseFloat(value) : value;

  if (Number.isNaN(numericValue)) {
    return <span className={clsx('text-content-tertiary', className)}>&mdash;</span>;
  }

  // Determine whether conversion is needed
  const sourceIsMetric = isMetricUnit(unit);
  const needsConversion =
    sourceIsMetric !== null &&
    ((sourceIsMetric && measurementSystem === 'imperial') ||
      (!sourceIsMetric && measurementSystem === 'metric'));

  let displayValue = numericValue;
  let displayUnit = getDisplayUnit(unit);

  if (needsConversion) {
    const result = convertUnit(numericValue, unit, measurementSystem);
    displayValue = result.value;
    displayUnit = result.displayUnit;
  }

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(numberLocale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: precision,
    }).format(displayValue);
  } catch {
    formatted = displayValue.toFixed(precision);
  }

  return (
    <span className={className}>
      {formatted}
      {displayUnit && (
        <>
          {' '}
          <span className="text-content-tertiary">{displayUnit}</span>
        </>
      )}
    </span>
  );
}
