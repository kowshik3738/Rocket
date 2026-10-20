import * as Location from 'expo-location';
import { AppState, AppStateStatus, Linking, Platform } from 'react-native';

export type LiveLocationDuration = 15 | 60 | 480; // in minutes: 15 mins, 1 hour, 8 hours

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type LiveLocation = {
  id: string;
  ownerId: string;
  latitude: number;
  longitude: number;
  startedAt: any;
  durationMinutes: LiveLocationDuration;
  expiresAt: any;
  stoppedAt?: any | null;
  updatedAt: any;
};

export const LIVE_LOCATION_UPDATE_INTERVAL_MS = 30000; // 30 seconds
export const LIVE_LOCATION_HEARTBEAT_INTERVAL_MS = 300000; // 5 minutes
export const LIVE_LOCATION_DISTANCE_THRESHOLD_M = 25; // 25 meters

/**
 * Validates latitude and longitude boundaries.
 */
export function isValidCoordinates(latitude: number, longitude: number): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90.0 &&
    latitude <= 90.0 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180.0 &&
    longitude <= 180.0
  );
}

/**
 * Calculates haversine distance in meters between two coordinates.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Formats coordinates for display (e.g. "37.7749° N, 122.4194° W").
 */
export function formatCoordinates(latitude: number, longitude: number): string {
  const latDir = latitude >= 0 ? 'N' : 'S';
  const lonDir = longitude >= 0 ? 'E' : 'W';
  const latVal = Math.abs(latitude).toFixed(4);
  const lonVal = Math.abs(longitude).toFixed(4);
  return `${latVal}° ${latDir}, ${lonVal}° ${lonDir}`;
}

/**
 * Opens coordinates in device default map application via platform-safe deep link.
 */
export async function openInDeviceMaps(
  latitude: number,
  longitude: number,
  label = 'Pinned Location'
): Promise<void> {
  if (!isValidCoordinates(latitude, longitude)) {
    throw new Error('Invalid coordinates.');
  }

  const encodedLabel = encodeURIComponent(label);
  let url: string;

  if (Platform.OS === 'ios') {
    url = `http://maps.apple.com/?ll=${latitude},${longitude}&q=${encodedLabel}`;
  } else if (Platform.OS === 'android') {
    url = `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodedLabel})`;
  } else {
    url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  const supported = await Linking.canOpenURL(url).catch(() => false);
  if (supported) {
    await Linking.openURL(url);
  } else {
    // Fallback to web maps URL
    const webFallback = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    await Linking.openURL(webFallback);
  }
}

/**
 * Checks or requests foreground location permission.
 * Never requests silently or in the background.
 */
export async function requestForegroundLocationPermission(): Promise<boolean> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.granted) {
      return true;
    }
    const requested = await Location.requestForegroundPermissionsAsync();
    return requested.granted;
  } catch (error) {
    console.warn('[LocationService] Permission check error:', error);
    return false;
  }
}

/**
 * Obtains a single fresh location fix.
 */
export async function acquireCurrentPosition(): Promise<Coordinates> {
  const granted = await requestForegroundLocationPermission();
  if (!granted) {
    throw new Error('Location permission is required to send your current location.');
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  const { latitude, longitude } = location.coords;
  if (!isValidCoordinates(latitude, longitude)) {
    throw new Error('Device returned invalid location coordinates.');
  }

  return { latitude, longitude };
}

/**
 * Local watcher manager for active owned live location shares.
 * Enforces single watcher, bounded updates (30s / 25m), and foreground-only lifecycle via AppState.
 */
type ActiveShareConfig = {
  shareId: string;
  onUpdateCoordinates: (coords: Coordinates) => Promise<void>;
  onStop: () => void;
  expiresAtMillis: number;
};

class LiveLocationManager {
  private activeShare: ActiveShareConfig | null = null;
  private locationSubscription: Location.LocationSubscription | null = null;
  private lastWrittenCoords: Coordinates | null = null;
  private lastWrittenAt: number = 0;
  private appStateSubscription: any = null;
  private expiryTimer: any = null;

  constructor() {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange.bind(this)
    );
  }

  public getActiveShareId(): string | null {
    return this.activeShare ? this.activeShare.shareId : null;
  }

  public async startTracking(
    shareId: string,
    initialCoords: Coordinates,
    expiresAtMillis: number,
    onUpdateCoordinates: (coords: Coordinates) => Promise<void>,
    onStop: () => void
  ): Promise<void> {
    // If another share was already active, stop it first
    await this.stopTracking();

    this.activeShare = {
      shareId,
      onUpdateCoordinates,
      onStop,
      expiresAtMillis,
    };
    this.lastWrittenCoords = initialCoords;
    this.lastWrittenAt = Date.now();

    // Schedule expiry timer
    const timeToExpiry = expiresAtMillis - Date.now();
    if (timeToExpiry <= 0) {
      await this.stopTracking();
      return;
    }

    this.expiryTimer = setTimeout(() => {
      void this.stopTracking();
    }, timeToExpiry);

    // Only start native watcher if app is in active foreground
    if (AppState.currentState === 'active') {
      await this.startNativeWatcher();
    }
  }

  public async stopTracking(shareId?: string): Promise<void> {
    if (shareId && this.activeShare && this.activeShare.shareId !== shareId) {
      return; // Not this share
    }

    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }

    await this.stopNativeWatcher();

    if (this.activeShare) {
      const callback = this.activeShare.onStop;
      this.activeShare = null;
      this.lastWrittenCoords = null;
      this.lastWrittenAt = 0;
      callback();
    }
  }

  private async startNativeWatcher(): Promise<void> {
    if (this.locationSubscription || !this.activeShare) return;

    try {
      this.locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: LIVE_LOCATION_UPDATE_INTERVAL_MS,
          distanceInterval: LIVE_LOCATION_DISTANCE_THRESHOLD_M,
        },
        (loc) => {
          void this.handleLocationCallback(loc);
        }
      );
    } catch (err) {
      console.warn('[LiveLocationManager] Failed to start native watcher:', err);
    }
  }

  private async stopNativeWatcher(): Promise<void> {
    if (this.locationSubscription) {
      try {
        this.locationSubscription.remove();
      } catch {
        // Ignore subscription cleanup error
      }
      this.locationSubscription = null;
    }
  }

  private async handleLocationCallback(loc: Location.LocationObject): Promise<void> {
    if (!this.activeShare) return;

    const now = Date.now();
    if (now >= this.activeShare.expiresAtMillis) {
      await this.stopTracking();
      return;
    }

    const { latitude, longitude } = loc.coords;
    if (!isValidCoordinates(latitude, longitude)) return;

    // Check bounded update frequency and distance threshold
    const timeElapsed = now - this.lastWrittenAt;
    let distance = Infinity;
    if (this.lastWrittenCoords) {
      distance = calculateDistanceMeters(
        this.lastWrittenCoords.latitude,
        this.lastWrittenCoords.longitude,
        latitude,
        longitude
      );
    }

    // Must be at least update interval OR significant distance, avoiding spamming
    if (timeElapsed < LIVE_LOCATION_HEARTBEAT_INTERVAL_MS && distance < LIVE_LOCATION_DISTANCE_THRESHOLD_M) {
      return;
    }

    this.lastWrittenCoords = { latitude, longitude };
    this.lastWrittenAt = now;

    try {
      await this.activeShare.onUpdateCoordinates({ latitude, longitude });
    } catch (err) {
      console.warn('[LiveLocationManager] Update coordinate failed:', err);
      // If error is permission denied (e.g. friendship ended / blocked / removed from group), terminate tracking
      if (err instanceof Error && (err.message.includes('permission') || err.message.includes('not a member'))) {
        await this.stopTracking();
      }
    }
  }

  private async handleAppStateChange(nextAppState: AppStateStatus): Promise<void> {
    if (nextAppState === 'active') {
      // App came to foreground. If share is still active and not expired, resume native watcher
      if (this.activeShare) {
        if (Date.now() >= this.activeShare.expiresAtMillis) {
          await this.stopTracking();
        } else {
          await this.startNativeWatcher();
        }
      }
    } else if (nextAppState.match(/inactive|background/)) {
      // Foreground live location: deliberately pause GPS watcher when app is backgrounded
      await this.stopNativeWatcher();
    }
  }
}

export const liveLocationManager = new LiveLocationManager();
