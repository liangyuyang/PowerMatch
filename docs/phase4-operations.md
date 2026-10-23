# Budgets, comparisons, mail recovery and BOM

## AI application budgets

Admin can set optional Token and CNY estimate limits for global/user × Beijing day/month. Blank disables each limit and preserves existing admission caps. Reservations and the settings/model revision checks occur atomically before provider requests. Reservations use UTF-8 input bytes plus framing allowance and 4096 output tokens. This is a conservative application estimate, not an exact tokenizer or provider billing guarantee.

Known usage reconciles the reservation. Unknown components, interrupted or expired calls retain a reservation; partial known usage exceeding the estimate increases accounting. Only proven pre-request failures release it. Unknown historical usage blocks admission under an enabled corresponding limit. Unknown prices, missing USD conversion and fixed Token Plans cannot bypass enabled CNY budgets. The budget does not automatically cancel a provider's already-running request or control spending outside PowerMatch.

## Comparison collections

Collections contain immutable server-canonical design snapshots and their condition-lock setting. Employees default to private. Public/company publication requires explicit acknowledgement; guest/nonemployee saves remain public. CAS and request idempotency protect updates. Account changes and source permission changes are checked during reads and writes. Bound historical case revisions retain their source access restrictions; an owner can still read their collection when their source becomes private, while outsiders cannot. Edited/versioned drafts are explicitly distinct from unchanged source revisions. Arbitrary manual input is not automatically taint-tracked.

## Mail recovery

An outbox attempt freezes sender, recipient, subject, body and provider idempotency key. A 60 s lease and claimant token fence concurrent/late completion. Retryable unknown outcomes use the same payload/key within 23 h and at most 3 attempts. This stays inside [Resend's 24 h key retention](https://resend.com/docs/dashboard/emails/idempotency-keys). Outcomes beyond that window, exhausted attempts and unverifiable legacy attempts require manual review; they are never blindly resent. A never-attempted configuration failure can be requeued explicitly after configuration is restored.

Recovery runs when the outbox is processed or an administrator selects maintenance. No new Cron schedule was installed and no automatic background timer is claimed. Login-link delivery remains synchronous and is not replayed from this outbox. Provider acceptance is not proof of recipient delivery.

## Selection BOM

The workbench exports a UTF-8 CSV of active PV/storage/regulation selections, quantities where established, editable design inputs separately from pinned source facts, source versions and available Spec/evidence fields. A changed/unknown PV module area gives an unknown module count. Direct supply omits the inactive regulator. Source identity/version mismatch remains unknown; the current catalog never replaces historical evidence. CSV quoting and formula neutralization apply to untrusted text.

This is a selection list, not a complete circuit BOM. Pin connections, required peripheral resistor/capacitor values, compatible wiring and a KiCad schematic are not generated or verified. Case/revision metadata attached to a modified workbench is labelled derived-from context, not certification of that revision's contents.
