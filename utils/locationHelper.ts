import * as Location from 'expo-location';

export const formatLocationType = (type?: string | null): string => {
  if (!type) return '';
  const normalized = type.toLowerCase();
  if (normalized === 'office') return 'Office';
  if (normalized === 'wfh' || normalized === 'work from home') return 'Work from home';
  if (normalized === 'outdoor' || normalized === 'outdoor duty') return 'Outdoor duty';
  return type;
};

/**
 * Reverse-geocodes GPS coordinates into a concise "City, Region" label.
 */
export const reverseGeocodeCoords = async (
  latitude: number,
  longitude: number
): Promise<string | null> => {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (results && results.length > 0) {
      const place = results[0];
      const parts = [place.city || place.subregion || place.district, place.region].filter(Boolean);
      if (parts.length > 0) {
        return parts.join(', ');
      }
      if (place.name) return place.name;
    }
  } catch (error) {
    console.log('Reverse geocoding failed:', error);
  }
  return null;
};

/**
 * Resolves the device's current GPS location into a "City, Region" label.
 */
export const getCurrentLocationLabel = async (): Promise<string | null> => {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    let granted = status === 'granted';
    if (!granted) {
      const req = await Location.requestForegroundPermissionsAsync();
      granted = req.status === 'granted';
    }
    if (!granted) return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return await reverseGeocodeCoords(pos.coords.latitude, pos.coords.longitude);
  } catch (error) {
    console.log('Failed to get current location label:', error);
    return null;
  }
};

/**
 * Formats a check-in location string combining optional attendance type and place label.
 */
export const formatAttendanceLocation = (
  attendanceType?: string | null,
  placeLabel?: string | null
): string => {
  const typeLabel = formatLocationType(attendanceType);
  if (typeLabel && placeLabel) return `${typeLabel}, ${placeLabel}`;
  if (placeLabel) return placeLabel;
  if (typeLabel) return typeLabel;
  return 'Location unavailable';
};

export const getTodayDateKey = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const isSameLocalDay = (dateStr: string): boolean => {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  return (
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate()
  );
};

/**
 * Resolves the display location for an attendance history item.
 */
export const getHistoryItemLocation = (
  item: {
    date: string;
    attendance_data: {
      checkin_time?: string;
      attendance_type?: string;
      location?: string;
      address?: string;
    } | null;
  } | null | undefined,
  todayCheckInLocation: string | null
): string => {
  if (!item) return 'No check-in';
  const data = item.attendance_data;
  if (!data || !data.checkin_time) {
    return 'No check-in';
  }
  const backendLoc = data.address || data.location;
  if (backendLoc) {
    return data.attendance_type
      ? formatAttendanceLocation(data.attendance_type, backendLoc)
      : backendLoc;
  }
  if (isSameLocalDay(item.date) && todayCheckInLocation) {
    return todayCheckInLocation;
  }
  const typeLabel = formatLocationType(data.attendance_type);
  return typeLabel || 'Location recorded';
};

