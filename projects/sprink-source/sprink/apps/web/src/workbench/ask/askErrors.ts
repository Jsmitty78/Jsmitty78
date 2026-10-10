import { ApiError } from "../api.js";

/** Raised by the Ask client itself when the request is aborted for taking too long. */
export class AskTimeoutError extends Error {
  constructor() { super("timeout"); this.name = "AskTimeoutError"; }
}

export type AskErrorKind = "auth" | "timeout" | "network" | "unavailable" | "invalid" | "server";
export interface AskProblem { kind: AskErrorKind; title: string; detail: string; retry: boolean }

/** Server messages for these codes are written for the person asking and contain no internals. */
const SAFE_CODES = new Set(["invalid_question"]);

/**
 * Turns any failure from the Ask request into wording for a fitter. Never shows stack traces,
 * raw exception text or server internals; only the server's own validation wording is passed through.
 */
export function describeAskError(error: unknown): AskProblem {
  if (error instanceof AskTimeoutError || (error instanceof ApiError && (error.status === 504 || error.status === 408)))
    return { kind: "timeout", title: "The search took too long", detail: "Sprink stopped waiting for the reference search. Your question is still here. Try again, or shorten the question.", retry: true };
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403)
      return { kind: "auth", title: "Your access was not accepted", detail: "Sprink could not confirm your access token. Reconnect with a valid token, then ask again. Your question is kept on this screen.", retry: false };
    if (error.status === 400 || error.status === 413 || error.status === 422)
      return { kind: "invalid", title: "Sprink could not use this question", detail: SAFE_CODES.has(error.code) ? error.message : "Edit the question and try again.", retry: false };
    if (error.status === 404)
      return { kind: "unavailable", title: "Reference search is not available", detail: "This Sprink server does not offer reference search right now. Try again later.", retry: true };
    if (error.status === 429)
      return { kind: "unavailable", title: "Too many questions at once", detail: "Wait a moment, then try again.", retry: true };
    if (error.status === 502 || error.status === 503 || error.code.startsWith("source_search"))
      return { kind: "unavailable", title: "Reference search is unavailable", detail: "The reference search service is not responding right now. Your question is kept. Try again in a moment.", retry: true };
    return { kind: "server", title: "Something went wrong on the server", detail: "Sprink could not finish the search. Your question is kept. Try again.", retry: true };
  }
  // fetch() rejects with a TypeError when the device is offline or the server cannot be reached.
  if (error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false))
    return { kind: "network", title: "Could not reach Sprink", detail: "Check your phone's signal or Wi-Fi, then try again. Your question is kept.", retry: true };
  return { kind: "server", title: "Something went wrong", detail: "Sprink could not finish the search. Your question is kept. Try again.", retry: true };
}
