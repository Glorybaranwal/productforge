"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { diffPrd } from "@/src/modules/prd/diff";
import type { Prd } from "@/src/modules/prd/schema";

const label = (p: Prd) =>
  `Version ${p.version} · ${p.status === "APPROVED" ? "approved" : "draft"}`;

/** Side-by-side comparison of two PRD versions (PF-032). */
export function CompareView({ versions }: { versions: Prd[] }) {
  const [leftId, setLeftId] = useState(versions.at(-2)?.id ?? versions[0]!.id);
  const [rightId, setRightId] = useState(versions.at(-1)!.id);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const left = versions.find((v) => v.id === leftId) ?? versions[0]!;
  const right = versions.find((v) => v.id === rightId) ?? versions.at(-1)!;
  const diff = diffPrd(left.content, right.content);
  const changed = diff.filter((d) => d.changed).length;

  return (
    <section aria-label="Compare versions" className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <Label htmlFor="compare-left">From</Label>
          <NativeSelect
            id="compare-left"
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="compare-right">To</Label>
          <NativeSelect
            id="compare-right"
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <p className="text-sm text-muted-foreground" role="status">
          {changed === 0
            ? "No differences."
            : `${changed} section${changed === 1 ? "" : "s"} changed.`}
        </p>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showUnchanged}
            onChange={(e) => setShowUnchanged(e.target.checked)}
          />
          Show unchanged sections
        </label>
      </div>

      {diff
        .filter((d) => d.changed || showUnchanged)
        .map((d) => (
          <div key={d.key} className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="flex items-center gap-2 font-semibold">
              {d.title}
              <span className="text-xs font-normal text-muted-foreground">
                {d.changed ? "Changed" : "No changes"}
              </span>
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <Column title={label(left)} lines={d.before} highlight={d.removed} tone="removed" />
              <Column title={label(right)} lines={d.after} highlight={d.added} tone="added" />
            </div>
          </div>
        ))}
    </section>
  );
}

function Column({
  title,
  lines,
  highlight,
  tone,
}: {
  title: string;
  lines: string[];
  highlight: string[];
  tone: "added" | "removed";
}) {
  const mark =
    tone === "added" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900 line-through";
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Empty.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {lines.map((line, i) => (
            <li key={i} className={highlight.includes(line) ? `rounded px-1 ${mark}` : "px-1"}>
              {highlight.includes(line) && (
                <span className="sr-only">{tone === "added" ? "Added: " : "Removed: "}</span>
              )}
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
