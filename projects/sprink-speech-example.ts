// Selected from Sprink's browser dictation controller.
// Original: sprink/apps/web/src/workbench/ask/speech.ts
// User-facing error states keep failed dictation distinct from cancellation.
export type DictationStatus =
  | "idle" | "requesting" | "listening" | "stopping" | "ready" | "cancelled"
  | "denied" | "unsupported" | "unavailable" | "no_speech" | "failed";

/** Browser error codes from SpeechRecognitionErrorEvent.error. */
export function statusForError(code: string): DictationStatus {
  switch (code) {
    case "not-allowed": return "denied";
    case "no-speech": return "no_speech";
    case "service-not-allowed": case "network": case "language-not-supported": return "unavailable";
    case "aborted": return "cancelled";
    default: return "failed"; // audio-capture, bad-grammar and anything a browser adds later
  }
}
