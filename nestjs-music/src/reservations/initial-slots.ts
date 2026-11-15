export interface InitialSlot {
  startsAt: string;
  capacity: number;
}

export interface PreparedInitialSlot extends InitialSlot {
  startsAtUtc: string;
}

export function prepareInitialSlots(
  slots: readonly InitialSlot[],
): PreparedInitialSlot[] {
  return slots.flatMap((slot) => {
    const startsAtUtc = toUtcInstant(slot.startsAt);
    return startsAtUtc === undefined
      ? []
      : [{ ...slot, startsAtUtc }];
  });
}

function toUtcInstant(startsAt: string): string | undefined {
  const timestampMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/i.exec(
      startsAt,
    );

  if (timestampMatch === null) {
    return undefined;
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    ,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = timestampMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText ?? 0);
  const offsetMinute = Number(offsetMinuteText ?? 0);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (daysInMonth ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }

  const timestamp = Date.parse(startsAt);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

export const INITIAL_SLOTS: readonly InitialSlot[] = [
  { startsAt: '2026-12-15T10:00:00-03:00', capacity: 4 },
  { startsAt: '2026-12-15T12:00:00-03:00', capacity: 4 },
  { startsAt: '2026-12-15T14:00:00-03:00', capacity: 4 },
];
