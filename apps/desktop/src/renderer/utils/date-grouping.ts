export type DateGroup =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "older";

export function getDateGroup(dateString: string): DateGroup {
  const date = new Date(dateString);
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - todayStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  if (date >= todayStart) return "today";
  if (date >= yesterdayStart) return "yesterday";
  if (date >= weekStart) return "this_week";
  if (date >= monthStart) return "this_month";
  return "older";
}

export function groupByDate<T extends { updatedAt: string }>(
  items: T[],
): [DateGroup, T[]][] {
  const groups = new Map<DateGroup, T[]>();
  for (const item of items) {
    const group = getDateGroup(item.updatedAt);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }

  const order: DateGroup[] = [
    "today",
    "yesterday",
    "this_week",
    "this_month",
    "older",
  ];
  return order
    .filter((group) => groups.has(group))
    .map((group) => [group, groups.get(group) ?? []]);
}

export function groupConversationsByDate<T extends { updatedAt: string }>(
  items: T[],
  labelForGroup: (group: DateGroup) => string,
): { label: string; conversations: T[] }[] {
  const sorted = [...items].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() -
      new Date(left.updatedAt).getTime(),
  );
  return groupByDate(sorted).map(([group, conversations]) => ({
    label: labelForGroup(group),
    conversations,
  }));
}
