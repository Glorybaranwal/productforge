import type { JiraItem, JiraPlan, JiraTarget } from "@/src/modules/exports/schema";

const PREVIEW_ROWS = 15;
const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
const td = "px-3 py-2 align-top";

/** The first rows exactly as they'll appear in the file, with the columns of the chosen edition. */
export function PlanPreview({
  plan,
  target,
  includeTasks,
  subtaskType,
}: {
  plan: JiraPlan;
  target: JiraTarget;
  includeTasks: boolean;
  subtaskType: string;
}) {
  const items = plan.items.filter((i) => includeTasks || i.level !== "subtask");
  const shown = items.slice(0, PREVIEW_ROWS);
  const type = (i: JiraItem) =>
    i.level === "epic" ? "Epic" : i.level === "story" ? "Story" : subtaskType;
  const link = (i: JiraItem) =>
    target === "cloud"
      ? (i.parentId ?? "")
      : i.level === "subtask"
        ? i.parentId
        : i.level === "story"
          ? i.epicName
          : "";

  return (
    <section aria-label="File preview" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">File preview</h2>
        <p className="text-xs text-muted-foreground">
          Showing {shown.length} of {items.length} rows · parents always come before their children
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-sm" aria-label="Jira rows">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className={th}>{target === "cloud" ? "Issue ID" : "Issue Id"}</th>
              <th className={th}>{target === "cloud" ? "Parent" : "Parent Id / Epic Link"}</th>
              <th className={th}>Issue Type</th>
              <th className={th}>Summary</th>
              <th className={th}>Priority</th>
              <th className={th}>Points</th>
              <th className={th}>Estimate</th>
              <th className={th}>Labels</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((i) => (
              <tr key={i.id}>
                <td className={`${td} font-mono text-xs`}>{i.id}</td>
                <td className={`${td} text-xs`}>{link(i)}</td>
                <td className={td}>{type(i)}</td>
                <td className={td}>
                  <span
                    className={
                      i.level === "subtask" ? "pl-6" : i.level === "story" ? "pl-3" : "font-medium"
                    }
                  >
                    {i.summary}
                  </span>{" "}
                  <span className="font-mono text-xs text-muted-foreground">{i.ref}</span>
                </td>
                <td className={td}>{i.priority ?? ""}</td>
                <td className={td}>{i.storyPoints ?? ""}</td>
                <td className={`${td} whitespace-nowrap`}>
                  {i.estimateHours !== null ? `${i.estimateHours} h` : ""}
                </td>
                <td className={`${td} text-xs text-muted-foreground`}>{i.labels.join(" ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
