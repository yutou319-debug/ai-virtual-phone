# Ordinary personal-cloud replies: single model executor

When personal push is active, ordinary one-to-one chat replies are submitted to
the user's Supabase before any local model request. The phone receives the
persisted outbox response; it does not run a parallel completion.

## Identity and recovery

- Each input has a stable key: `reply-once:<sessionId>:<inputMessageId>`.
- A unique database index keeps simultaneous or repeated submissions on the same
  task. Completed and failed tasks are retained rather than overwritten.
- The generator atomically changes pending to running before calling the model.
  Immediate dispatch and the cron dispatcher may both reach the function, but
  only one can claim the task.
- An unconfirmed submission, model error, or crashed execution never falls back
  to a new phone-side model call. Stale running reply_once tasks become failed,
  rather than pending. This prefers avoiding repeat charges over automatic retry.
- New input messages create new tasks. Reusing the same input does not regenerate
  a completed or failed task.

## Deployment and behavior

Publish the web changes and redeploy personal push through Float to update the
gateway, generator, database kind constraint, and cron definition together.
Older clouds reject reply_once; the phone reports that redeployment is needed
and does not start another model call.

Ordinary replies are dispatched immediately instead of waiting for the old
90-second fallback lease. If immediate dispatch fails before the generator
claims the task, cron can dispatch the pending task. The phone polls status while
waiting and imports the durable outbox. Finishing on the server does not depend
on keeping the phone page alive.

There is no phone-side token streaming for these replies. The existing offline
cloud snapshot supports its cloud shortcuts and response parser, but does not
run the phone's native tool loop. Group chats, scheduled follow-ups and other
engines are outside this ordinary-reply change. API providers may still charge
for an interrupted request; this change prevents Float from automatically
starting a second completion for that input, not the provider's internal billing.

## Regression check

Run `node scripts/check-single-reply-executor.cjs` with the repository's
TypeScript development dependency installed. It covers simultaneous duplicate
submissions, reopens, failed-task reuse, distinct inputs, lost acknowledgements,
old gateways, outbox import, and the actual chat entry gate.
