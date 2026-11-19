/**
 * Given/When/Then templates for the demo QA engine (ADR-011): a positive, a negative and an edge
 * case for each kind of story.
 */
import type { BacklogStoryRef } from "@/src/ai/schemas/backlog";
import { withArticle } from "@/src/modules/stories/schema";

import { outcome, singular, trigger, type Category, type Kind } from "./qa-phrasing";

export function templates(
  story: BacklogStoryRef,
  cat: Category,
  verb: string,
  object: string,
  rest: string,
) {
  const given =
    story.asA === "product owner"
      ? "the feature is live"
      : `I'm signed in as ${withArticle(story.asA)}`;
  const action = `I ${rest}`;
  const thing = object || "items";
  const one = object ? withArticle(singular(object)) : "an item";
  const T: Record<Category, [Kind, string, string, string][]> = {
    create: [
      [
        "positive",
        given,
        `${action} with every required field filled in`,
        `it is saved and I see a confirmation with its reference number`,
      ],
      [
        "negative",
        given,
        `I try to ${verb} ${thing} with a required field left empty`,
        `nothing is saved and the missing field is highlighted`,
      ],
      [
        "edge",
        given,
        `I ${verb} the same ${singular(thing)} twice within 2 seconds`,
        `only one is saved`,
      ],
    ],
    upload: [
      [
        "positive",
        given,
        `${action} using an allowed file type and size`,
        `the upload completes and I see the file listed`,
      ],
      [
        "negative",
        given,
        `I try to upload a file type or size that isn't allowed`,
        `the upload is refused and I'm told which types and sizes are allowed`,
      ],
      [
        "edge",
        given,
        `my connection drops halfway through an upload`,
        `no broken file is saved and I can retry`,
      ],
    ],
    book: [
      [
        "positive",
        `${given} and there is a free slot`,
        `${action}`,
        `the slot is reserved for me and I get a confirmation`,
      ],
      [
        "negative",
        given,
        `I try to book a slot that is in the past`,
        `the booking is refused and I'm shown the next free slots`,
      ],
      [
        "edge",
        `${given} and two people choose the same slot`,
        `we both confirm within 2 seconds`,
        `only one booking succeeds and the other person is offered the next free slot`,
      ],
    ],
    find: [
      [
        "positive",
        `${given} and there are ${thing} I'm allowed to see`,
        action,
        `I see those ${thing} and nothing I'm not allowed to see`,
      ],
      [
        "negative",
        "I'm not signed in",
        `I try to ${verb} ${thing}`,
        `I'm asked to sign in and no data is shown`,
      ],
      [
        "edge",
        `${given} and nothing matches`,
        action,
        `I see a "no results" message instead of an error`,
      ],
    ],
    track: [
      [
        "positive",
        `${given} and ${one} is in progress`,
        action,
        `I see its current status and when it last changed`,
      ],
      [
        "negative",
        given,
        `I try to ${verb} ${withArticle(singular(thing))} that isn't mine`,
        `access is refused and nothing about it is shown`,
      ],
      [
        "edge",
        `${given} and the latest status can't be loaded`,
        action,
        `I see the last known status with its time`,
      ],
    ],
    export: [
      [
        "positive",
        `${given} and there is data for the period I choose`,
        action,
        `a file downloads that contains exactly that data`,
      ],
      [
        "negative",
        "I don't have access to this data",
        `I try to ${verb} ${thing}`,
        `the download is refused with a clear message`,
      ],
      [
        "edge",
        `${given} and there is no data for the period I choose`,
        action,
        `I'm told there is nothing to download instead of getting an empty file`,
      ],
    ],
    notify: [
      [
        "positive",
        `${given} with these notifications turned on`,
        `${trigger(rest)}`,
        `I receive ${one || "a notification"} that says what happened and links to it`,
      ],
      [
        "negative",
        `${given} with these notifications turned off`,
        `${trigger(rest)}`,
        `no notification is sent to me`,
      ],
      [
        "edge",
        `${given} with these notifications turned on`,
        `the same thing happens twice within 1 minute`,
        `I receive one notification, not two`,
      ],
    ],
    decide: [
      [
        "positive",
        `${given} and a request is waiting for my decision`,
        `I ${verb} it`,
        `its status changes and the requester is told`,
      ],
      [
        "negative",
        `${given} and the request was already decided`,
        `I try to ${verb} it again`,
        `the action is blocked and the earlier decision stays`,
      ],
      [
        "edge",
        "two reviewers open the same request",
        `both decide within 2 seconds`,
        `only the first decision is saved and the second reviewer is told`,
      ],
    ],
    pay: [
      [
        "positive",
        `${given} with a valid payment method`,
        action,
        `the payment is confirmed and I receive a receipt`,
      ],
      [
        "negative",
        `${given} and my payment is declined`,
        `I try to pay`,
        `nothing is confirmed and I can try another method`,
      ],
      ["edge", `${given} and my connection drops after I pay`, `I retry`, `I am not charged twice`],
    ],
    change: [
      [
        "positive",
        `${given} and ${one} I'm allowed to change`,
        `I ${verb} it`,
        `the change is saved and shown straight away`,
      ],
      [
        "negative",
        `${given} and ${one} that can no longer be changed`,
        `I try to ${verb} it`,
        `the change is refused and I'm told why`,
      ],
      [
        "edge",
        `someone else changed ${one} after I opened it`,
        `I save my change`,
        `I'm warned and shown the latest version before anything is overwritten`,
      ],
    ],
    retention: [
      [
        "positive",
        "a record is inside the retention period",
        "someone with access searches for it",
        "they can still open it",
      ],
      [
        "negative",
        "a record is inside the retention period",
        "someone tries to delete it",
        "deletion is refused and the attempt is logged",
      ],
      [
        "edge",
        "a record has just passed the retention period",
        "the scheduled clean-up runs",
        "the record is handled as the rule says and the action is logged",
      ],
    ],
    default: [
      ["positive", given, "I use this feature", `${outcome(story.iWant)}`],
      [
        "negative",
        "I don't have permission for this",
        "I try to use this feature",
        "I'm refused with a clear message and nothing changes",
      ],
      [
        "edge",
        `${given} and the service is temporarily unavailable`,
        "I try to use this feature",
        "I see an error and can try again without losing what I entered",
      ],
    ],
  };
  return T[cat];
}
