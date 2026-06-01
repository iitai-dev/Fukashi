import type { MasonryKey } from "./types";

export function stringifyKey(key: MasonryKey): string {
  return String(key);
}

export function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function hashList(values: readonly string[]): string {
  return hashString(values.join("\x1f"));
}

export function hashRecord(record: Record<string, string | number>): string {
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => key + ":" + String(record[key]));
  return hashString(parts.join("\x1e"));
}
