# Ask Sprink — frontend pilot readiness

Branch: `ask/frontend-pilot-mobile-voice` (based on `origin/main` at `90aca2a`).
Scope: the Ask Sprink frontend (`apps/web/src/workbench/ask/*`) plus three one-line hooks into shared files. No server, retrieval, CI or deployment code was changed.

## What changed

- **One-column, phone-first Ask page.** Question box first, then the answer, then the supporting sources, then the source passage. It works at about 390 px wide with no horizontal scrolling. On desktop the question box stays pinned while results scroll. On phones the page scrolls normally, because a pinned box and the iPhone keyboard don't fit on one screen.
- **Question box.** It is multi-line and grows as you type. Text is 17 px, so iOS Safari doesn't zoom in on focus. The Clear button is 44 px and has Undo. On desktop Enter asks; on touch devices Enter adds a new line and you tap Ask. Ask is disabled while the box is empty, while a search is running, and while voice entry is listening. A counter appears near the 1000-character server limit, and Ask is blocked if voice text pushes the question past it. Nothing is cut off silently.
- **The draft survives.** The question is never cleared on submit or on failure. It is also kept in `sessionStorage` for the tab, so it survives a page reload or a reconnect after an auth failure.
- **No accidental double submits.** A ref-based in-flight guard means two taps in the same frame start only one request.
- **Loading.** You see "Searching the reference library…" with a note that it can take up to 30 seconds, plus a Cancel button. The question you asked stays visible under "Results for". There is no fake progress bar. The request gives up after 45 s; the server itself gives the search service 30 s.
- **Answer before sources.**
  - The answer block shows the backend `summary`.
  - It also shows the backend's edition caveat (`context.edition.reason` when the status is `unknown`), and any `conflicts`, `unresolved` and `missing` items.
  - Conflicts get their own "Sources disagree" box.
- **Source cards.** One card per original page, using the existing de-duplication logic unchanged. Each card shows source type, passage kind, a Sample tag, document title, publisher, edition, section (id and heading), page or page range, the permitted quote (clamped to 4 lines) or the backend's quote note, and quality flags. Metadata the backend doesn't send is left out, never made up. Long titles, section ids and URL-like identifiers wrap instead of overflowing.
- **Source viewer.** This is the existing original-PDF excerpt and full-page viewer, kept and restyled.
  - Tapping "View passage" scrolls to it, and "Back to sources" returns focus to that card.
  - If there's no page image or it fails to load, the indexed text opens automatically and the original link is shown where one exists.
  - The full-page dialog fills the screen on phones.
  - Display restrictions are untouched: everything shown is what the server already allowed.
- **No supporting source is a normal result.** It has its own neutral (not red) card that explains Sprink searched the library and won't guess, shows the backend summary, gives three rephrasing tips, and offers an Edit question button.
- **Plain-language errors** (`askErrors.ts`) for auth, timeout, network, search unavailable, bad request, rate limit and general server errors. Only the server's own `invalid_question` wording is passed through. Raw exception text, stack traces, section-budget details and the like are never shown. Each error offers Try again, Edit question, or Reconnect (auth).
- **"Ask another question"** clears the box (with Undo), scrolls to the top and focuses the input.
- **Accessibility.**
  - Every control has a label.
  - Voice status and results are announced through `role="status"` / `aria-live`; errors use `role="alert"`.
  - Focus outlines are 3 px, and all main controls are at least 44–48 px tall.
  - Listening is shown with the word "Listening", a dot and the Stop button, not by colour alone.
  - The pulse animation is turned off under `prefers-reduced-motion`.
- **Japanese copy.** Every new UI string has a Japanese pair in `ask/askMessages.ts`. The app defaults to Japanese.

## Voice implementation

**Approach.** It uses the browser's own Web Speech API (`SpeechRecognition`, or `webkitSpeechRecognition` on Safari and Chrome). No new runtime dependency and no API keys in the frontend. The code is in `ask/speech.ts`:
- `startDictation()` is a small controller you can test without a browser.
- `useDictation()` is the React wrapper.

**Flow:** tap **Speak** → "Starting the microphone… Allow microphone access if your browser asks." → **Listening** (red dot, live "heard so far" preview, **Stop** and **Cancel**) → the transcript is **added after any text already in the box** → note: "Voice text added. Check technical terms and measurements before asking." with **Undo** → the fitter edits if needed and taps **Ask Sprink**.

**Rules it follows:**
- A transcript is never submitted automatically. Ask is disabled while listening, and finishing dictation only fills the text box.
- The transcript is never rewritten. No LLM correction, no normalisation of "NFPA 13R", fractions, model numbers and so on. Whitespace is the only thing touched.
- Existing typed text is never replaced. Voice text is appended, and Undo restores the earlier text until you edit it.
- Each tap records one utterance (`continuous = false`). Recognition stops when:
  - the user taps Stop (keeps what was heard) or Cancel (discards it),
  - the browser detects the end of speech,
  - the component unmounts or the route changes,
  - the tab is hidden or the user switches apps,
  - the Ask panel is hidden inside a work package, or Escape is pressed.
- The recognition language follows the UI language: `ja-JP` for JP, `en-US` for EN.

**States handled:** idle, requesting permission, listening, stopping, transcription ready, cancelled, permission denied, unsupported browser, recognition unavailable (`service-not-allowed`, `network`, `language-not-supported`), no speech, and recognition failure (`audio-capture` or anything else).

**Browser support (expected):**

| Browser | Expectation |
|---|---|
| iOS Safari 14.5+ | `webkitSpeechRecognition` present. Needs Siri & Dictation turned on. Recognition is done by Apple and may need network. |
| Chrome / Edge (desktop, Android) | Supported. Audio goes to the browser vendor's speech service, so it needs network. |
| Chrome on iOS | Uses WebKit; support depends on iOS version. Check on the device. |
| Firefox | No Speech Recognition API. The mic button shows as unavailable (dashed, slashed icon), and tapping it explains why. Typing works normally. |
| Home-screen web app (iOS standalone) | Historically unreliable for speech recognition. Test before relying on it. |

**Privacy:**
- The mic only starts when the user taps.
- Listening is always shown on screen.
- Sprink doesn't record, upload or store audio.
- The transcript is only kept as text in the question box (and in the tab's `sessionStorage` draft).
- No analytics are added.
- The browser's own speech service (Apple or Google) processes the audio. That is their policy, not Sprink's, and should be mentioned to pilot users.

## Bugs fixed

| File | What was wrong → what changed |
|---|---|
| `ask/AskPanel.tsx` | **Answered results never showed the answer.** The `summary`, edition caveat and conflicts from the server were dropped, and only page buttons were shown. They are now shown first. |
| `ask/AskPanel.tsx` | **An `answered` response with no usable sources showed an empty "0 results" list.** It now gets the same no-source card as `no_source`. The old no-source box also looked like a plain empty panel and offered no next step. |
| `ask/AskPanel.tsx` | **Double tap could send two requests.** The `busy` state check only took effect on the next render. Replaced with an in-flight ref. |
| `ask/AskPanel.tsx` / `askApi.ts` | **Requests could hang forever, and an old response could overwrite a newer one.** Added an `AbortSignal` with a 45 s timeout, user Cancel, abort on unmount, and a request sequence check. |
| `ask/AskPanel.tsx` | **Raw server text appeared in the error box,** e.g. "Request failed (500)" or the 422 section-budget message. Replaced with fitter-facing wording from `askErrors.ts`. |
| `ask/AskPanel.tsx` | **Enter submitted on phones,** so there was no way to type a multi-line question on an iPhone. Enter now only submits when the pointer is a mouse or trackpad. |
| `ask/AskPanel.tsx` | **Several viewer strings weren't translated:** "Page", "Original PDF", "Full page" alt text. They now go through `tr`. |
| `ask/rule-search.css` | **The textarea inherited a bordered, resizable `.fa-app textarea` style** inside the bordered card, and was 15 px on answers (iOS zooms below 16 px). It is now borderless at 17 px, with 44–48 px controls throughout. |
| `ask/rule-search.css` | **The page couldn't scroll on iPhone.** The page was locked to `100dvh` with an inner scroll area, which traps scrolling behind the iOS keyboard. Phones now scroll the document. |
| `WorkbenchApp.tsx` | **No way to recover from an auth error on `/codes`.** It now passes `onAuthFailure={signOut}` so the error offers **Reconnect**. The draft survives the reconnect. |

## Tests

New (31 tests, all in `apps/web/src/workbench/ask/`):

- `speech.test.ts` (12): constructor detection (standard and webkit prefix), error-to-state mapping, single-utterance settings, final transcript returned word for word (no correction), results rebuilt when browsers repeat them, Stop keeps interim text (including the grace timeout), Cancel discards and ignores late events, permission denied, no speech, recognition failure, start throwing, dispose on unmount.
- `askErrors.test.ts` (4): classification of auth, timeout, network, unavailable, invalid and server errors; only the `invalid_question` text passes through; no internals leak (stack text, section ids, env-var-like strings); retry only where it helps.
- `AskPanel.test.ts` (15, happy-dom, mocked `fetch` and mocked `webkitSpeechRecognition`, no microphone):
  - Typed questions: empty-question behaviour; a single submit with loading state and duplicate-submit prevention; answer-before-sources order with edition, section and page; conflicts shown; no-source state; 503 error with the question kept and retry; no raw server text; very long titles and section ids rendered in full.
  - Voice: unsupported-browser fallback; transcript fills the box, does **not** submit, can be edited, and the edited text is what gets sent; voice text is appended after typed text and Undo works; Cancel adds nothing; permission denied, recognition failure and no-speech messages; recognition aborted on unmount.
  - Transcript append helper.

New dev dependency: `happy-dom` (`apps/web` devDependencies only, used for the component tests; not part of the shipped bundle).

## Verification

Commands actually run in this worktree (Node 26.5, pnpm 10.17.1):

| Command | Before changes | After changes |
|---|---|---|
| `pnpm typecheck` | pass | pass |
| `pnpm test` | 23 files / 223 tests pass | 26 files / 254 tests pass |
| `pnpm build` | pass (existing >500 kB chunk warning) | pass (same warning) |
| `npx vitest run apps/web/src/workbench/ask` | — | 3 files / 31 tests pass |

There were no failures before the changes.

I also did a mutation check: removing the in-flight guard makes the duplicate-submit test fail, and putting it back makes it pass again.

**Browser check.** I ran the Vite dev server against a throwaway local mock of `/api/sources`, `/api/rules/search` and the page-image endpoint (real search needs API keys I don't have), in the desktop app's built-in Chromium browser.
- **Phone width (375×812):**
  - No horizontal page overflow (`scrollWidth == innerWidth`).
  - Typed ask, loading, answer, source cards and the passage viewer all work.
  - Voice listening → Stop appends the transcript without submitting; Cancel keeps the existing text.
  - Permission denied, no speech and unsupported-browser messages all appear (speech API stubbed in the page).
- **Desktop width:** the pinned question box, answer, conflicts, viewer, full-page dialog and close, the no-source card, and 503 / 500 / 401 errors all render correctly.
- **Japanese UI:** checked.
- **Console:** the only errors were the 503 / 500 / 401 network responses I triggered on purpose.

**Not verified here:** a real iPhone, real microphone input, and the Ask panel embedded inside a work package (`Workbench.tsx` → `.wf-codes`), which needs a real work package.

## Remaining limitations

- **The answer text is the backend's summary sentence** ("N matching passages from M documents…"). `/api/rules/search` doesn't produce a written answer. The frontend shows exactly what the backend sends and doesn't make one up.
- **Speech recognition is done by the browser vendor.** Accuracy for "NFPA 13R", "1-1/2 inch", "CPVC" and model numbers varies. That's why the transcript is always reviewed and never auto-submitted.
- **Japanese UI means Japanese recognition.** With the UI in Japanese (the default), recognition is `ja-JP`, so English standard names spoken in an otherwise English sentence may come out poorly. Switching the UI to EN switches recognition to `en-US`. There's no separate voice-language setting yet.
- **iOS needs Dictation turned on.** Recognition fails with `service-not-allowed`, shown as "unavailable", when Siri & Dictation is off. Standalone home-screen mode may not support recognition.
- **The 45 s client timeout doesn't cancel server work.** It only stops waiting.
- **Some originals can't be opened from Sprink.** The "Open original" link only appears for absolute `http(s)` originals, as before. Uploaded sources whose original is an authenticated `/api/...` path can't be opened in a new tab.
- **The top navigation still shows Work packages and Field inspections.** I deliberately didn't remove them, to avoid editing unrelated workbench pages.

## Manual smoke test (real iPhone, before the pilot)

1. Open Sprink in **Safari**, connect, and tap **Rule search**. The page should fit the screen with no sideways scrolling.
2. Type a two-line question. Return adds a new line, the box grows, and the page doesn't zoom.
3. Tap **Ask Sprink** twice quickly. One search, the "Searching…" state, and the question stays visible.
4. The answer appears first. Open a source card with **View passage**, use **Full page** → **Close**, then **Back to sources**.
5. Ask something not in the library. You should get the neutral "No supporting source found" card and **Edit question**.
6. Turn on Airplane Mode and ask. You should get "Could not reach Sprink" with the question kept. Turn it off and tap **Try again**.
7. Tap **Speak**. Allow the microphone. Check that "Listening" and the red **Stop** button are shown.
8. Say "Does NFPA 13R allow CPVC for one and a half inch branch lines". Tap **Stop**. The text appears in the box and **nothing is submitted**.
9. Fix any misheard terms, then tap **Ask Sprink**.
10. Type some text, then dictate. The voice text is added after it; **Undo** removes only the voice text.
11. Tap **Speak**, then **Cancel**. Nothing is added.
12. Tap **Speak** and stay silent. You get "No speech was heard".
13. Tap **Speak**, then press the Home button or switch apps. Come back: it is no longer listening.
14. Settings › Safari › Microphone → Deny. Tap **Speak**: you get the blocked-microphone message and typing still works.
15. Try once in Japanese UI (JP) and once in EN to compare recognition of English code terms.

## For the backend agent

- **No frontend dependency on new backend fields.** The frontend reads only the existing `AskAnswer` / `Citation` fields from `apps/server/src/sources` (mirrored in `ask/askApi.ts`).
- **What the frontend relies on:**
  - `status` (`answered` | `no_source` | `needs_input`), `summary`, `context.edition.{status,reason}`, `conflicts`, `unresolved`, `missing`, and `sources[*]` metadata.
  - Error bodies shaped `{ error, code }`.
  - `invalid_question` messages are shown to users word for word, so keep them user-facing.
  - Any `source_search*` code, 502 or 503 is shown as "Reference search is unavailable".
- **422 `source_section_too_large`** includes section ids and budget wording. The frontend hides it and shows a generic message. It reads like an operator or library problem rather than a user one; consider logging it server-side.
- **If `/api/rules/search` later returns a written answer** (separate from passages), it can go straight into the answer block; today `summary` is used.
- **Timeouts:** the client gives up after 45 s. The server's search transport allows 30 s. If you change server timeouts, keep the client value above them.
