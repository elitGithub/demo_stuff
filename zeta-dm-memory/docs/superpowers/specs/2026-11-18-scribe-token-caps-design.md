# Zeta Scribe: answer caps for the per-reply calls

Date: 2026-11-18
Status: approved by the operator on 2026-11-18 ("Raise.").

## Why

The header keeps showing `Scribe: answer was cut off; status 200; finish length`, also with all three model slots on `mistralai/mistral-large-4-0`. The Scribe slot's answers (the scene, two short lines) are capped at 700 tokens and the checker's at 1,500 (`ScribeBoot.Settings.MaxTokens`). The gateway asks every call for low-effort reasoning (`ScribeGateway.js:220`), and OpenRouter lists `reasoning` as accepted by that model, so hidden reasoning tokens most likely count against those caps. The reading model already needed its cap raised from 8,000 to 40,000 for the same kind of cut-off.

## Change

`ScribeBoot.Settings.MaxTokens.Scribe` and `.Pedant` become 4,000 each. Only the tokens a model actually uses are billed; the cap only stops a runaway answer. Nothing else changes.

## Not in this change

Showing the per-reply calls (role, tokens out, how the answer ended) in Last calls: noted in the backlog, not approved yet.

## Check

The boot test that pins the caps is updated; the whole walk passes; after install, the operator watches whether the cut-off line comes back.
