"use client";

import { CodeChip } from "@/components/prd/section-editors";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/src/lib/api-client";
import type { Requirement } from "@/src/modules/requirements/schema";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  STORY_POINTS,
  StoryFields,
  type Epic,
} from "@/src/modules/stories/schema";
import type { StoryView } from "@/src/modules/stories/state";

import { EditorSection, StoryChip } from "./editor-section";
import { useAutosave } from "./use-autosave";

type Fields = StoryFields & { epicId: string };

const pick = (s: StoryView): Fields => ({
  epicId: s.epicId,
  title: s.title,
  asA: s.asA,
  iWant: s.iWant,
  soThat: s.soThat,
  priority: s.priority,
  storyPoints: s.storyPoints,
  requirementCodes: s.requirementCodes,
  dependsOn: s.dependsOn,
});

/** Who, what, why, priority, points and links of a draft story (autosaved). */
export function StoryFieldsEditor({
  story,
  epics,
  requirements,
  stories,
}: {
  story: StoryView;
  epics: Epic[];
  requirements: Requirement[];
  stories: StoryView[];
}) {
  const { draft, change, status, message } = useAutosave<Fields>(
    pick(story),
    (value) => {
      const parsed = StoryFields.safeParse(value);
      return parsed.success
        ? { ok: true, value: { ...parsed.data, epicId: value.epicId } }
        : { ok: false, message: parsed.error.issues[0]?.message ?? "Check the story" };
    },
    (value) =>
      apiRequest(`/api/stories/${story.id}`, {
        method: "PATCH",
        body: { section: "story", value },
      }),
  );
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    change({ ...draft, [key]: value });
  const byCode = new Map(requirements.map((r) => [r.code, r]));
  const linkable = requirements.filter((r) => !draft.requirementCodes.includes(r.code));
  const dependable = stories.filter(
    (s) => s.code !== story.code && s.status !== "REJECTED" && !draft.dependsOn.includes(s.code),
  );
  const id = (field: string) => `${story.id}-${field}`;

  return (
    <EditorSection title="Story" status={status} message={message}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={id("title")}>Title</Label>
          <Input
            id={id("title")}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("asA")}>As a</Label>
          <Input id={id("asA")} value={draft.asA} onChange={(e) => set("asA", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("epic")}>Epic</Label>
          <NativeSelect
            id={id("epic")}
            value={draft.epicId}
            onChange={(e) => set("epicId", e.target.value)}
          >
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} · {e.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("iWant")}>I want</Label>
          <Textarea
            id={id("iWant")}
            rows={2}
            className="min-h-10"
            value={draft.iWant}
            onChange={(e) => set("iWant", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("soThat")}>So that</Label>
          <Textarea
            id={id("soThat")}
            rows={2}
            className="min-h-10"
            value={draft.soThat}
            onChange={(e) => set("soThat", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("priority")}>Priority</Label>
          <NativeSelect
            id={id("priority")}
            value={draft.priority}
            onChange={(e) => set("priority", e.target.value as Fields["priority"])}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("points")}>Story points</Label>
          <NativeSelect
            id={id("points")}
            value={draft.storyPoints ?? ""}
            onChange={(e) =>
              set(
                "storyPoints",
                e.target.value ? (Number(e.target.value) as Fields["storyPoints"]) : null,
              )
            }
          >
            <option value="">Not estimated</option>
            {STORY_POINTS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Requirements</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.requirementCodes.map((code) => (
            <CodeChip
              key={code}
              code={code}
              requirement={byCode.get(code)}
              onRemove={() =>
                set(
                  "requirementCodes",
                  draft.requirementCodes.filter((c) => c !== code),
                )
              }
            />
          ))}
          {linkable.length > 0 && (
            <NativeSelect
              aria-label={`Link a requirement to ${story.code}`}
              className="h-7 w-44 max-w-full py-0 text-xs"
              value=""
              onChange={(e) =>
                e.target.value &&
                set("requirementCodes", [...draft.requirementCodes, e.target.value])
              }
            >
              <option value="">+ Link requirement</option>
              {linkable.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code} · {r.text.slice(0, 50)}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Depends on</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.dependsOn.length === 0 && (
            <span className="text-xs text-muted-foreground">Nothing — can start any time.</span>
          )}
          {draft.dependsOn.map((code) => (
            <StoryChip
              key={code}
              code={code}
              title={stories.find((s) => s.code === code)?.title}
              onRemove={() =>
                set(
                  "dependsOn",
                  draft.dependsOn.filter((c) => c !== code),
                )
              }
            />
          ))}
          {dependable.length > 0 && (
            <NativeSelect
              aria-label={`Add a dependency to ${story.code}`}
              className="h-7 w-44 max-w-full py-0 text-xs"
              value=""
              onChange={(e) =>
                e.target.value && set("dependsOn", [...draft.dependsOn, e.target.value])
              }
            >
              <option value="">+ Add dependency</option>
              {dependable.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.title.slice(0, 40)}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
      </div>
    </EditorSection>
  );
}
