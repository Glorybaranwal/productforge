import { notFound } from "next/navigation";

import { AppError } from "./errors";

/**
 * Loads a page's data and turns a service's NOT_FOUND into Next's 404 page. Pages render their JSX
 * after this returns — outside try/catch, where React can't catch render errors anyway.
 */
export async function orNotFound<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}
