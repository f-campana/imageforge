# PixelSmith Port Audit

## Scope

This audit compares concepts in PixelSmith's current planning, capability, doctor, and reporting
modules with the bounded ImageForge rendering-contract slice. It classifies ideas, not brands or
files. No PixelSmith code is copied.

## Port now

| Idea                         | Decision                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Explicit machine error codes | Use the concept only for `ImageForgeRenderError` so missing assets and invalid policies are testable.    |
| Deterministic pure boundary  | Keep `getPictureProps()` pure and deterministic; this is a rendering invariant, not a transform IR port. |

These are the only concepts directly required to make the public rendering seam clear and
behaviorally testable.

## Port later

| Idea                              | Why later                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Transform-plan intermediate model | Valuable before broader processor/back-end work, but unrelated to manifest consumption.          |
| Capability and engine detection   | Useful when multiple processors or optional encoders exist; current rendering is data-only.      |
| Doctor architecture               | Useful for diagnosing binaries, configuration, and serving assumptions after integrations exist. |
| Structured execution reports      | ImageForge already has JSON reporting; convergence needs a separate compatibility design.        |
| Shared structured error taxonomy  | Rendering has a local typed error now; a CLI-wide taxonomy needs evidence and migration work.    |
| Explain/dry-run planning output   | Relevant to compiler planning, not the pure manifest-to-rendering seam.                          |

## Do not port

| Idea                              | Reason                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| PixelSmith package identity/brand | ImageForge remains the product and published package.                                     |
| Wholesale CLI architecture        | Replacing proven cache, concurrency, check, and manifest behavior would broaden risk.     |
| Broad conversion scope            | Additional formats and conversion modes are outside this slice and need product evidence. |
| Separate rendering package now    | One public root export is enough to prove the boundary before package topology changes.   |

## Result

The rendering contract borrows only the narrow ideas of deterministic boundaries and coded
failures. Transform planning, capability detection, doctor diagnostics, and reporting convergence
remain independent future work. They should not be prerequisites for framework adapter evidence.
