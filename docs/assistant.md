# The assistant, and the model inside the phone

What spec §20 asks for, and how it is wired. Read this before touching `src/ui/Chat.tsx`,
`src/core/intent.ts` or `src/shell/model.ts`.

## The chain, in order

Everything he writes goes through the same three steps, and stops at the first one that
answers:

1. **`parseCommand`** (`src/core/commands.ts`). The command grammar plus a date anywhere
   in the line. Code, not a model: instant, offline, free, identical every time. If it
   parses, it is written — today straight away, another day after a confirmation.
2. **The model** (`src/shell/model.ts`), only when step 1 refused the line. It is asked
   for one structured object, and the only thing it can propose is **a line of the same
   grammar**, which goes back through `parseCommand`. It never writes and it never
   reaches the database.
3. **The refusal**, said out loud. If the model is not there, the answer says so instead
   of pretending the sentence was unintelligible.

The reason for the order is cost and trust, in that order: the thing he types most often
is `agua 710`, and running a language model over it would be slower and less reliable
than the parser that already handles it.

## Why the model may not write

A parser that does not understand says so. A model that does not understand invents, and
the invention has the right shape: `peso 7.4` is a valid line and a wrong body weight.
So everything the model produced is confirmed before it lands, showing the line it
understood, and the confirmation for another day also says what that day currently holds
(spec §20.4).

## The native side

`@react-native-ai/apple` v0.12, Apple Foundation Models, on the device. Requires iOS 26,
Apple Intelligence enabled, and the new architecture. Nothing leaves the phone, there is
no account and there is no rate limit.

**Only the TurboModule is used.** `src/shell/model.ts` asks
`TurboModuleRegistry.get('NativeAppleLLM')` for it directly instead of importing the
package, for two reasons:

- the package's index pulls in the Vercel AI SDK and `zod` to use none of it — the same
  rule as the icons, one import per thing and never the barrel (checked: the web bundle
  carries `NativeAppleLLM` and no `@ai-sdk/*`);
- its own JS calls `getEnforcing`, which **throws at import time** when the module is not
  compiled in, and this file is imported from the root of the app. `get` returns null.

The lookup is lazy and inside a `try`, because react-native-web has no
`TurboModuleRegistry` at all and the browser is where renders get measured.

The npm package still has to be installed: it is what `expo prebuild` and `pod install`
compile. `macos-26` runners carry the iOS 26 SDK, and the Swift side is behind
`#if canImport(FoundationModels)` and `@available(iOS 26, *)`, so an older toolchain
compiles it into an `isAvailable()` that answers false.

## The schema is the contract

`INTENT_SCHEMA` in `src/core/intent.ts` is the subset of JSON Schema that Apple's parser
accepts: objects, strings, `enum` on strings, `pattern`, numeric bounds, `required`,
`description`, and arrays of those. Anything richer throws on the Swift side
(`AppleLLMSchemaParser`). Guided generation means the answer has the right shape; it does
not mean the answer is true, so `readIntent` validates every field and anything it cannot
read becomes "no entendí" rather than a write.

The answer comes back as the text of the last transcript segment, which is JSON when a
schema was sent. The last message of the call **must** have role `user` or the native
side rejects it.

## Questions

Five, and they are answered by the app, not by the model: the best estimated 1RM for an
exercise (from the charts loader's `trends`), the score of a day, the current streak,
today's protein against the target, and when he last trained. The model only picks which
one was asked and for what — exact answers from SQLite instead of a small model reciting
numbers it half remembers.

Adding a fifth means adding it to the enum in `INTENT_SCHEMA`, to `Question`, and to
`lookUp` in `Chat.tsx`. There is no free-form query path on purpose.

## What a 3B model gets wrong, and what fixed it

First run on the phone, every message came back as `preguntar / marca / press banca`:
"hola", "cuándo fui al gym por última vez", "hoy dormí 5h52m". It was not reading the
input at all, it was **copying the last example in the prompt**, which happened to be
that one. Three changes:

- the rules now say what each `tipo` is for and that **"nada" is the answer when in
  doubt**, and `nada` is first in the enum;
- the examples end with the "nada" ones, and each is marked as independent of the last,
  so the nearest thing to copy is a refusal rather than a question;
- the history sent along is **the last exchange only**. With four messages, one wrong
  answer fed itself: the model saw its own "no tengo marcas de press banca" and said it
  again.

The lesson generalises: with guided generation the answer always has the right shape, so
a model that has stopped reading looks exactly like a model that is working. Anything
that decides what happens must be checked by code afterwards, which is why nothing it
proposes is written without the parser and a confirmation.

## What is not built yet

Streaming (the answer appears whole; it is one short line), tool calling (the package
supports it, and the closed question list is a better fit for a 3B model), and the cloud
fallback (spec §20.3 allows it, nothing calls out yet).
