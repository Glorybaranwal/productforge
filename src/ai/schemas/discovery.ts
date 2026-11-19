export { DiscoveryOutput } from "@/src/modules/requirements/schema";
export type { DiscoveryOutput as DiscoveryOutputType } from "@/src/modules/requirements/schema";

/** Source id used for requirements that come from clarification answers. */
export const ANSWERS_SOURCE_ID = "answers";

/** What the discovery stage receives. Source text is untrusted data, never instructions. */
export type DiscoveryInput = {
  project: { name: string; domain: string; audience: string; teamSize: number };
  sources: { id: string; name: string; text: string }[];
  /** Resolved clarifying questions from earlier runs. */
  answers: {
    question: string;
    state: "answered" | "assumption" | "skipped";
    answer: string | null;
  }[];
};
