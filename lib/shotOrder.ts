/**
 * The dump is ordered by when a shot was taken, newest first, not by when it was dropped in.
 * Shots with no capture time (screenshots, stripped files, most videos) fall back to drop time.
 */
export const shotTime = (m: { takenAt?: string | Date; createdAt: string | Date }) =>
  new Date(m.takenAt ?? m.createdAt).getTime();

export const newestShotFirst = <T extends { takenAt?: string | Date; createdAt: string | Date }>(list: T[]) =>
  list.sort((a, b) => shotTime(b) - shotTime(a));
