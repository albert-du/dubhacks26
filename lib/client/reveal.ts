/**
 * First paint used to start every preview at once, so tiles finished in a
 * random order. Rows now share a small queue: an earlier row starts before
 * the next one, and a row stays hidden until each of its images has settled.
 */

export const REVEAL_CONCURRENCY = 4;
export const REVEAL_TIMEOUT_MS = 8000;

export type SlotState = "idle" | "loading" | "settled";

export type PlanSlot = {
  key: string;
  group: string;
  index: number;
  row: number;
  state: SlotState;
  /** Lower runs first inside the same screen of rows. */
  priority: number;
};

export type Phase = { load: boolean; show: boolean };

/** The first screen of a top-priority list can start from the HTML, before the queue runs. */
export function revealImmediately(order: number, row: number, priority = 0) {
  if (priority > 0) return false;
  const width = Math.max(1, row);
  return order >= 0 && order < Math.min(width, REVEAL_CONCURRENCY);
}

function waveOf(slot: PlanSlot) {
  return Math.floor(slot.index / Math.max(1, slot.row));
}

/**
 * Decide which images should have a src, and which may be shown.
 * A later row does not start until every registered image in earlier rows has
 * started, and it does not appear until those earlier rows are on screen.
 * Missing indexes are gaps, so they do not block the row.
 */
export function planAll(slots: PlanSlot[], concurrency: number, enabled: (group: string) => boolean): Map<string, Phase> {
  const result = new Map<string, Phase>();
  for (const slot of slots) result.set(slot.key, { load: false, show: false });

  let inFlight = 0;
  const started = new Set<string>();
  for (const slot of slots) {
    if (slot.state === "loading") inFlight += 1;
    if (slot.state === "loading" || slot.state === "settled") started.add(slot.key);
  }

  const startOrder = [...slots].sort((a, b) => {
    return waveOf(a) - waveOf(b) || a.priority - b.priority || a.index - b.index || a.group.localeCompare(b.group);
  });

  for (const slot of startOrder) {
    const phase = result.get(slot.key)!;
    if (slot.state === "loading" || slot.state === "settled") {
      phase.load = true;
      continue;
    }
    if (!enabled(slot.group) || inFlight >= concurrency) continue;
    const row = waveOf(slot);
    const blocked = slots.some((other) => {
      if (other.group !== slot.group || other.key === slot.key) return false;
      return waveOf(other) < row && !started.has(other.key);
    });
    if (blocked) continue;
    phase.load = true;
    started.add(slot.key);
    inFlight += 1;
  }

  const byGroup = new Map<string, PlanSlot[]>();
  for (const slot of slots) {
    const list = byGroup.get(slot.group) ?? [];
    list.push(slot);
    byGroup.set(slot.group, list);
  }
  for (const members of byGroup.values()) {
    const width = Math.max(1, members[0].row);
    const rows = [...new Set(members.map((slot) => Math.floor(slot.index / width)))].sort((a, b) => a - b);
    let open = true;
    for (const row of rows) {
      const rowMembers = members.filter((slot) => Math.floor(slot.index / width) === row);
      if (!open || rowMembers.some((slot) => slot.state !== "settled")) {
        open = false;
        continue;
      }
      for (const slot of rowMembers) result.get(slot.key)!.show = true;
    }
  }
  return result;
}

type LiveSlot = PlanSlot;

const live = new Map<string, LiveSlot>();
const listeners = new Set<() => void>();
const groupEnabled = new Map<string, boolean>();
let cached = new Map<string, Phase>();
let emitting = false;
let pending = false;

function slotKey(group: string, id: string) {
  return `${group}\0${id}`;
}

function recompute() {
  const phases = planAll([...live.values()], REVEAL_CONCURRENCY, (group) => groupEnabled.get(group) !== false);
  for (const slot of live.values()) {
    if (phases.get(slot.key)?.load && slot.state === "idle") slot.state = "loading";
  }
  cached = phases;
}

function emit() {
  if (emitting) {
    pending = true;
    return;
  }
  emitting = true;
  try {
    do {
      pending = false;
      recompute();
      for (const fn of [...listeners]) fn();
    } while (pending);
  } finally {
    emitting = false;
  }
}

/** Hidden tabs stop taking new preview slots. A request that already started can finish. */
export function setRevealEnabled(group: string, on: boolean) {
  if (groupEnabled.get(group) === on) return;
  groupEnabled.set(group, on);
  emit();
}

export function watchReveal(
  group: string,
  id: string,
  index: number,
  row: number,
  onChange: (phase: Phase) => void,
  priority = 0,
): () => void {
  const key = slotKey(group, id);
  live.set(key, { key, group, index, row: Math.max(1, row), state: "idle", priority });
  const listener = () => onChange(cached.get(key) ?? { load: false, show: false });
  listeners.add(listener);
  emit();
  return () => {
    listeners.delete(listener);
    if (live.get(key)?.state) live.delete(key);
    emit();
  };
}

export function settleReveal(group: string, id: string) {
  const slot = live.get(slotKey(group, id));
  if (!slot || slot.state === "settled") return;
  slot.state = "settled";
  emit();
}

type UpgradeJob = { url: string; onOk: () => void; cancelled: boolean };

const upgradeQueue: UpgradeJob[] = [];
let upgradeActive = 0;

/** One full-size swap at a time, after the preview row is already on screen. */
export function queueUpgrade(url: string, onOk: () => void): () => void {
  const job: UpgradeJob = { url, onOk, cancelled: false };
  upgradeQueue.push(job);
  pumpUpgrades();
  return () => {
    job.cancelled = true;
    const at = upgradeQueue.indexOf(job);
    if (at >= 0) upgradeQueue.splice(at, 1);
  };
}

function pumpUpgrades() {
  if (typeof Image === "undefined") return;
  while (upgradeActive < 1 && upgradeQueue.length > 0) {
    const job = upgradeQueue.shift();
    if (!job || job.cancelled) continue;
    upgradeActive += 1;
    const img = new Image();
    const finish = (ok: boolean) => {
      upgradeActive -= 1;
      if (ok && !job.cancelled) job.onOk();
      pumpUpgrades();
    };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = job.url;
  }
}
