# V2 release parity continuation

Continue the authorized clean-slate rebuild from the verified server workspace. Production remains unchanged and PR #36 remains draft.

1. Port large-document and repeated-preview resource acceptance to the v2 shell. Current pending browser cases exercise 240-page late-page addressing/real rotation export and Chromium forced-GC JS heap across eight preview/export/disposal cycles. Keep native/GPU and physical-device memory limits explicit.
2. Run automated accessibility checks on desktop/320px home, editing workspace and 390px Office account/consent controls. Use installed axe-core with WCAG2/2.1 A/AA and best-practice rules. Retain real violation targets, fix source defects rather than disabling rules, and keep manual assistive-technology acceptance separate. New `e2e/v2-accessibility.spec.ts` is prepared; initial browser execution is pending.
3. Audit v2 offline/update/recovery parity against the retained R3/R5 tests. The current v2 entry imports only the shell/auth module; service-worker registration/preparation controls and safe update activation require an explicit parity check before claiming offline readiness. Reuse verified asset/caching engines; do not infer offline behavior from deployed manifest/SW files returning 200.
4. Continue mapping legacy behavioral/security/export cases to v2 replacements; visual legacy selectors alone are not replacement acceptance. Preserve existing operation safety and actual-byte checks. Do not suppress the legacy release gate to turn CI green.
5. Complete hosted interactive/browser-to-real-backend verification when the protected browser session is available, and the broader corpus/load/device/manual accessibility checks. Durable production image/retention/cost and the known Supabase advisor decisions remain release gates.

No new VM, snapshot rebuild, public access change, merge or production promotion is implied by this validation work.

Initial resource CI: Chromium's controlled result-layout regression, phone-width check, all server journeys and eight-cycle JS heap check pass. The 240-page case reached page 221 but timed out on a test-only `getByLabel(..., exact:true)` locator; the retained AX snapshot explicitly names the controls as comboboxes Rotate/Rotation. The selector now uses those exact observed roles/names. This is not a processing/performance timeout. Initial accessibility tests are included in the follow-up run to reveal real violations before source fixes.
