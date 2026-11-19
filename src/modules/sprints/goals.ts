/** The planner's sprint goal: what the sprint delivers, by epic, biggest first. The PM can rewrite it. */
type GoalStory = { epicCode: string; epicTitle: string; points: number | null };

export function autoGoal(stories: GoalStory[]): string {
  if (!stories.length) return "";
  const byEpic = new Map<string, { title: string; points: number; count: number }>();
  for (const s of stories) {
    const e = byEpic.get(s.epicCode) ?? { title: s.epicTitle, points: 0, count: 0 };
    e.points += s.points ?? 0;
    e.count += 1;
    byEpic.set(s.epicCode, e);
  }
  const epics = [...byEpic.entries()]
    .sort(([ac, a], [bc, b]) => b.points - a.points || b.count - a.count || ac.localeCompare(bc))
    .map(([, e]) => e.title);
  const [first, second] = epics;
  const goal =
    epics.length === 1
      ? `Deliver ${first}`
      : epics.length === 2
        ? `Deliver ${first} and ${second}`
        : `Deliver ${first}, ${second} and ${epics.length - 2} more ${epics.length - 2 === 1 ? "epic" : "epics"}`;
  return goal.length > 300 ? `${goal.slice(0, 297)}…` : goal;
}
