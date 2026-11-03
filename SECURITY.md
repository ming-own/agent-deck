# AgentDeck Security Policy

AgentDeck is maintained by [ming-own](https://github.com/ming-own).
Security fixes currently target the main development branch; no AgentDeck
release support window has been established yet.

## Reporting a vulnerability

Report AgentDeck issues to its maintainer, not to the upstream project's email.
Use a private contact method published on the maintainer's GitHub profile, or
this repository's private vulnerability reporting option if it is enabled.
Do not put secrets or exploitable vulnerability details in public issues.
Include affected versions, reproduction steps, and the expected impact.

## Local Agent Threat Boundary

AgentDeck's local permission policy, HumanInteraction approval records, Git
previews, and audit trail reduce accidental or model-initiated risk. They are
not an operating-system sandbox. If an Agent can run an arbitrary shell as the
same OS user as AgentDeck, that capability must be treated as full access to that
user's files and processes.

Advanced Git tells the model not to use options that execute external
programs, rejects known executable-option forms, returns structured rejection
reasons for self-correction, and requires user review for dangerous or
destructive operations. This is defense in depth and depends on model
discipline plus informed user approval; it is not a complete parser for Git's
option-abbreviation language. Local policy/profile state also remains inside
the same-UID boundary until an OS sandbox provides independent integrity.
