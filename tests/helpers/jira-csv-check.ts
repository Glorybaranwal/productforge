/**
 * Checks a CSV against Jira's documented CSV-import rules (Atlassian: "Import data from a CSV file"
 * and "Keep work parent-child relationships during CSV import to Jira Cloud"). The real test is an
 * import into a Jira test project; this catches everything we can check without one.
 */

/** Strict RFC 4180 parser: quoted fields, doubled quotes, CRLF, line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        quoted = false;
        i++;
        if (i < text.length && !/[,\r\n]/.test(text[i]!))
          throw new Error(`Text after a closing quote at ${i}`);
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (cell !== "") throw new Error(`Quote inside an unquoted cell at ${i}`);
      quoted = true;
      i++;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
    } else if (c === "\r" || c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += c;
      i++;
    }
  }
  if (quoted) throw new Error("Unclosed quote");
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function checkJiraCsv(
  text: string,
  target: "cloud" | "datacenter",
  subtaskType = "Sub-task",
): string[] {
  const problems: string[] = [];
  const [header, ...rows] = parseCsv(text);
  if (!header) return ["Empty file"];
  const col = (name: string) => header.indexOf(name);
  const need =
    target === "cloud"
      ? ["Issue ID", "Parent"]
      : ["Issue Id", "Parent Id", "Epic Name", "Epic Link"];
  for (const name of ["Summary", "Issue Type", ...need])
    if (col(name) < 0) problems.push(`Missing column ${name}`);
  if (problems.length) return problems;
  if (rows.length > 1500) problems.push(`${rows.length} rows — over the recommended 1,500`);
  const idCol = col(need[0]!);
  const parentCol = col(need[1]!);
  const seen = new Map<string, string>(); // id → issue type
  const epicNames = new Set<string>();
  rows.forEach((r, n) => {
    const at = `Row ${n + 2}`;
    if (r.length !== header.length)
      problems.push(`${at}: ${r.length} cells, header has ${header.length}`);
    const type = r[col("Issue Type")]!;
    const id = r[idCol]!;
    const parent = r[parentCol]!;
    const summary = r[col("Summary")]!;
    if (!/^\d+$/.test(id)) problems.push(`${at}: Issue ID must be a number`);
    if (seen.has(id)) problems.push(`${at}: duplicate Issue ID ${id}`);
    if (!summary.trim()) problems.push(`${at}: empty Summary`);
    if (summary.length > 255) problems.push(`${at}: Summary over 255 characters`);
    if (!["Epic", "Story", subtaskType].includes(type))
      problems.push(`${at}: unexpected Issue Type ${type}`);
    const parentType = parent ? seen.get(parent) : undefined;
    if (parent && !parentType) problems.push(`${at}: parent ${parent} isn't an earlier row`);
    if (type === "Epic" && parent) problems.push(`${at}: an epic can't have a parent here`);
    if (type === subtaskType && parentType !== "Story")
      problems.push(`${at}: a sub-task needs a story as parent`);
    if (target === "cloud" && type === "Story" && parentType !== "Epic")
      problems.push(`${at}: story's Parent must be an epic`);
    if (target === "datacenter") {
      if (type === "Story" && parent)
        problems.push(`${at}: Data Center stories link epics with Epic Link, not Parent Id`);
      if (type === "Epic") {
        const name = r[col("Epic Name")]!;
        if (!name) problems.push(`${at}: an epic needs an Epic Name`);
        epicNames.add(name);
      }
      if (type === "Story" && !epicNames.has(r[col("Epic Link")]!))
        problems.push(`${at}: Epic Link doesn't match an earlier Epic Name`);
    }
    header.forEach((h, k) => {
      const v = r[k] ?? "";
      if (h === "Labels" && /\s/.test(v)) problems.push(`${at}: label "${v}" has a space`);
      if (h === "Priority" && v && !["Highest", "High", "Medium", "Low", "Lowest"].includes(v))
        problems.push(`${at}: priority ${v}`);
      if (h === "Story Points" && v && !/^\d+(\.\d+)?$/.test(v))
        problems.push(`${at}: story points ${v}`);
      if (h === "Original Estimate" && v && !/^\d+$/.test(v))
        problems.push(`${at}: estimate must be whole seconds`);
    });
    seen.set(id, type);
  });
  return problems;
}
