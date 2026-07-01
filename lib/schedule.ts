import { DateTime } from "luxon";

// Convert a local wall-clock value ("YYYY-MM-DDTHH:mm") in a named timezone to
// an absolute UTC ISO string. Returns null if the input is invalid.
export const localToUtcIso = (local: string, tz: string): string | null => {
  if (!local) return null;
  const dt = DateTime.fromISO(local, { zone: tz });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
};

// Convert a stored UTC ISO instant back to a datetime-local input value in the
// given timezone ("YYYY-MM-DDTHH:mm").
export const utcIsoToLocalInput = (iso: string, tz: string): string => {
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(tz);
  if (!dt.isValid) return "";
  return dt.toFormat("yyyy-LL-dd'T'HH:mm");
};

// Human-readable scheduled time for display, e.g. "Mon, 30 Jun 2026 at 14:30 GMT+8".
export const formatScheduled = (iso: string, tz: string): string => {
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(tz);
  if (!dt.isValid) return iso;
  return dt.toFormat("ccc, dd LLL yyyy 'at' HH:mm ZZZZ");
};

// The browser/host timezone, falling back to UTC.
export const detectTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
];

// All IANA timezones when the runtime supports it, otherwise a curated subset.
export const listTimezones = (): string[] => {
  const supported = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[];
    }
  ).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      const values = supported("timeZone");
      if (Array.isArray(values) && values.length > 0) return values;
    } catch {
      // Fall through to the curated list.
    }
  }
  return FALLBACK_TIMEZONES;
};
