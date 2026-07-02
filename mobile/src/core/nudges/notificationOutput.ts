/**
 * notificationOutput — a SECOND output for the nudge bus: phone local notifications.
 *
 * The payoff of the bus: this subscribes ONCE and instantly delivers nudges from EVERY
 * feature (Hydration / Energy / Overwhelm) as phone notifications — without touching any
 * feature's code. Adding outputs is O(1), not O(features).
 *
 * PRIVACY: expo-notifications schedules LOCAL notifications on-device. No network, no
 * server, no user data leaves the phone. (Local notifications ≠ push notifications.)
 */

// eslint-disable-next-line import/no-unresolved -- added during native setup (expo install expo-notifications)
import * as Notifications from 'expo-notifications';

import { nudgeCenter } from './NudgeCenter';

let detach: (() => void) | null = null;

/** Wire phone notifications to the nudge bus. Requests permission once. Idempotent. */
export async function attachNotificationOutput(): Promise<() => void> {
  if (detach) return detach;
  try {
    await Notifications.requestPermissionsAsync();
  } catch {
    /* denied / unavailable → nudges still reach the glasses; notifications just no-op */
  }
  const unsub = nudgeCenter.subscribe((n) => {
    Notifications.scheduleNotificationAsync({
      content: { title: 'LifePilot', body: n.message },
      trigger: null, // deliver now
    }).catch(() => {
      /* never let one output break the others */
    });
  });
  detach = () => { unsub(); detach = null; };
  return detach;
}
