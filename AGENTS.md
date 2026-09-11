# Coding guidelines

## General

- **Type safety is mandatory.** Use strict TypeScript, explicit domain types, and typed contracts between modules. Avoid `any`, `@ts-ignore`, and assertions that hide type errors; narrow `unknown` before use.
- **No defensive coding.** Let broken assumptions fail visibly and fix their cause. Do not add speculative guards, fallback chains, automatic retries, or defaults that conceal bugs.
- Validate external input at entry points and reject invalid values explicitly. Trust established contracts inside the application.
- Never swallow exceptions, use empty catch blocks, or log an error and continue as if the operation succeeded. Catch only to handle an expected failure explicitly or report it at an application boundary.
- Keep functions focused, dependencies explicit, and changes within the requested scope. Introduce abstractions when a concrete need exists.
- Build and verify the smallest working flow first. Defer lifecycle coordination and speculative edge-case machinery until demonstrated behavior or an explicit requirement calls for them.
- Keep shared contracts limited to data callers need. Keep platform implementation details inside the platform layer; use targeted logs when diagnostics are needed instead of exposing those details in shared results or UI.
- **Prefer self-explanatory code over comments.** Use clear names, types, and control flow. If code needs an explanation of what it does, improve the code instead of adding a comment.
- Add a comment only to justify a non-obvious decision, external constraint, or necessary exception that the code cannot express. Do not narrate statements, repeat signatures, or label skeletons and obvious behavior. Keep architecture and future implementation plans in `ARCH.md`; preserve required license notices.
- Unimplemented calls must fail explicitly; never return placeholder success or fabricated data.
- Run checks appropriate to the change. Test meaningful behavior and failure paths; distinguish fixture results from live platform verification.
- For this prototype, the user handles browser/UI testing. Run type checks, unit tests and builds unless the user asks for UI verification.

## Frontend

- Keep UI rendering and interaction handlers separate from playback logic, platform integrations, and message transport.
- Use typed request/response contracts. Represent pending, success, and failure states explicitly; display errors where the user initiated the action.
- Do not report a seek as completed merely because it was requested. Show observed player state accurately.
- Use semantic HTML, associated labels, keyboard-accessible controls, and visible focus states. Clearly label and disable unfinished features.
- Keep popup state temporary. The video-tab controller owns playback state that must survive popup closure.
- Render file contents and reasons as text, never executable markup. Keep browser permissions limited to implemented features.

## Backend and background code

- Apply these rules to the extension service worker and any future server. No server is required by the current skeleton.
- Keep transport handlers thin. Put domain behavior in focused modules and platform-specific behavior in adapters.
- Register Chrome event handlers synchronously at module scope. Use typed messages and explicit success/error responses across context boundaries.
- Keep the service worker stateless between requests. Put continuous playback timing in the video tab and persistent preferences in storage when implemented.
- Use seconds throughout domain and message contracts. Convert platform-specific units only inside the relevant adapter.
- Preserve failure context across asynchronous boundaries. A failed operation must remain a failure; do not convert it into empty data or a successful response.
