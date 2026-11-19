import type { JiraTarget } from "@/src/modules/exports/schema";

const CLOUD = [
  "You need Jira admin rights. Import into a company-managed project: team-managed projects can't set an epic as parent through CSV import, and they use a different story-points field.",
  "In Jira: Settings (⚙) → System → External system import → CSV. If Jira opens the new import experience, choose “Switch to the old experience” first.",
  "Upload the file and choose the project. Keep the default encoding (UTF-8) and delimiter (comma).",
  "Map the columns: Issue ID → Issue Id · Parent → Parent · Issue Type → Issue Type · Summary → Summary · Description → Description · Priority → Priority · Story Points → Story Points · every Labels column → Labels · Original Estimate → Original Estimate (only if time tracking is on).",
  "If your site names the sub-task type differently (for example “Subtask”), set it above before downloading, or tick “Map field value” for Issue Type.",
  "Begin the import, then open a story: its parent should be the epic and its sub-tasks listed under it.",
];

const DATACENTER = [
  "You need Jira admin rights.",
  "In Jira: Administration → System → External System Import → CSV. Upload the file and choose the project.",
  "Map the columns: Issue Id → Issue Id · Parent Id → Parent Id · Epic Name → Epic Name · Epic Link → Epic Link · Issue Type → Issue Type · Summary → Summary · Description → Description · Priority → Priority · Story Points → Story Points · every Labels column → Labels · Original Estimate → Original Estimate.",
  "Stories find their epic by name (Epic Link = Epic Name); ProductForge epic names are unique per project.",
  "Begin the import, then open an epic: its stories should be listed, each with its sub-tasks.",
];

/** How to import the CSV, for the chosen Jira edition (Atlassian's documented steps, 2024+). */
export function ImportGuide({ target }: { target: JiraTarget }) {
  const steps = target === "cloud" ? CLOUD : DATACENTER;
  return (
    <section aria-label="Import guide" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">
        How to import into {target === "cloud" ? "Jira Cloud" : "Jira Data Center"}
      </h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">If something doesn’t link</p>
        <p>
          “Doesn’t have a valid parent”: turn sub-tasks on (System → Work items → Sub-tasks) and
          keep the rows in the file’s order — parents come first. If stories import without their
          epic, link them afterwards with bulk edit (set Parent). Atlassian recommends at most 1,500
          items per file.
        </p>
      </div>
    </section>
  );
}
