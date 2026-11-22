"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiRequest } from "@/src/lib/api-client";
import { orderPair } from "@/src/modules/requirements/compare";
import type { RequirementHistory, RequirementVersion } from "@/src/modules/requirements/history";
import { EVIDENCE_LABELS } from "@/src/modules/requirements/schema";
import { diffWords, type DiffPart } from "@/src/modules/requirements/word-diff";

import { StatusBadge } from "./badges";

type Load =
  { state: "loading" } | { state: "error" } | { state: "ready"; versions: RequirementVersion[] };

/** Side-by-side comparison of two versions of one requirement (PF-056). Fetches on first render. */
export function RequirementHistoryPanel({
  projectId,
  code,
  id,
}: {
  projectId: string;
  code: string;
  id: string;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ history: RequirementHistory[] }>(`/api/projects/${projectId}/requirements/history`)
      .then(({ history }) => {
        const versions = history.find((h) => h.code === code)?.versions ?? [];
        if (!cancelled)
          setLoad(versions.length > 1 ? { state: "ready", versions } : { state: "error" });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, code, attempt]);

  const retry = () => {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  };

  return (
    <div id={id} className="space-y-3 rounded-lg border p-3">
      {load.state === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading versions…
        </p>
      )}
      {load.state === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-destructive">Couldn&apos;t load the history. Try again.</p>
          <Button size="sm" variant="outline" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
      {load.state === "ready" && (
        <Compare projectId={projectId} code={code} versions={load.versions} />
      )}
    </div>
  );
}

const label = (v: RequirementVersion) => `Version ${v.version}`;

function Compare({
  projectId,
  code,
  versions,
}: {
  projectId: string;
  code: string;
  versions: RequirementVersion[];
}) {
  const [leftV, setLeftV] = useState(versions.at(-2)!.version);
  const [rightV, setRightV] = useState(versions.at(-1)!.version);
  const picked = versions.find((v) => v.version === leftV) ?? versions[0]!;
  const other = versions.find((v) => v.version === rightV) ?? versions.at(-1)!;
  const [left, right] = orderPair(picked, other);
  const parts = diffWords(left.text, right.text);
  const same = left.version === right.version;

  return (
    <div className="space-y-3">
      {versions.length > 2 && (
        <div className="flex flex-wrap items-end gap-3">
          <Picker
            id={`${code}-left`}
            name="Compare"
            value={leftV}
            onChange={setLeftV}
            versions={versions}
          />
          <Picker
            id={`${code}-right`}
            name="With"
            value={rightV}
            onChange={setRightV}
            versions={versions}
          />
        </div>
      )}
      {same && (
        <p role="status" className="text-sm text-muted-foreground">
          Both sides show the same version. Pick two different versions to see what changed.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Column projectId={projectId} version={left}>
          <Wording parts={parts} side="left" />
        </Column>
        <Column projectId={projectId} version={right} showChange={right.version > left.version}>
          <Wording parts={parts} side="right" />
        </Column>
      </div>
    </div>
  );
}

/** Removed words are struck through on the left, added words are marked on the right; sr-only text keeps both readable without colour. */
function Wording({ parts, side }: { parts: DiffPart[]; side: "left" | "right" }) {
  const hidden = side === "left" ? "added" : "removed";
  return parts
    .filter((p) => p.kind !== hidden)
    .map((p, i) => (
      <Fragment key={i}>
        {p.kind === "removed" ? (
          <del className="text-muted-foreground decoration-2">
            <span className="sr-only">Removed: </span>
            {p.text}
          </del>
        ) : p.kind === "added" ? (
          <ins className="rounded-sm bg-accent px-0.5 font-semibold text-accent-foreground underline decoration-2 underline-offset-4">
            <span className="sr-only">Added: </span>
            {p.text}
          </ins>
        ) : (
          p.text
        )}{" "}
      </Fragment>
    ));
}

function Picker({
  id,
  name,
  value,
  onChange,
  versions,
}: {
  id: string;
  name: string;
  value: number;
  onChange: (v: number) => void;
  versions: RequirementVersion[];
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{name}</Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {versions.map((v) => (
          <option key={v.version} value={v.version}>
            {label(v)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function Column({
  projectId,
  version: v,
  showChange = false,
  children,
}: {
  projectId: string;
  version: RequirementVersion;
  showChange?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label(v)} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{label(v)}</h4>
        <StatusBadge status={v.status} />
        <span className="text-xs text-muted-foreground">
          Evidence: {EVIDENCE_LABELS[v.evidence]}
        </span>
      </div>
      <p className="text-sm leading-relaxed">{children}</p>
      {showChange && !v.change && (
        <p className="text-xs text-muted-foreground">Edited without a change request.</p>
      )}
      {showChange && v.change && (
        <p className="text-xs text-muted-foreground">
          Changed in{" "}
          <Link
            href={`/dashboard/projects/${projectId}/changes#${v.change.code}`}
            className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {v.change.code}
          </Link>
          : {v.change.reason}
        </p>
      )}
    </section>
  );
}
