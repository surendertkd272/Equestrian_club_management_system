// "Level 1" or, for a level that runs as several groups on an exam day,
// "Level 1 · Group 2".
export function sittingLabel(levelName: string, groupNo: number | null | undefined): string {
  return groupNo ? `${levelName} · Group ${groupNo}` : levelName;
}
