/**
 * People who have a name come before people who don't. Inside each group, a
 * larger shot count comes first. The same name-ness and count keep their order,
 * so a shot's tags stay in face order within named and within unnamed.
 */
export function namedFirst<T extends { name?: string; count?: number }>(people: readonly T[]): T[] {
  return [...people].sort((a, b) => Number(Boolean(b.name)) - Number(Boolean(a.name)) || (b.count ?? 0) - (a.count ?? 0));
}
