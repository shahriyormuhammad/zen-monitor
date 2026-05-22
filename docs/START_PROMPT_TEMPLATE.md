# Start Prompt Template

Use one of these templates as your first message in a new session.

## Template A: Quick Start (Recommended)

```text
Use `/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/SESSION_BOOTSTRAP.md` as bootstrap context.

Rules:
- Do not do a full project scan.
- Read only files needed for this task.
- Treat `AGENTS.md` and `docs/PROJECT_GUIDE.md` as canonical.
- Keep changes scoped to one coherent backlog slice.
- Run relevant checks for touched surfaces.

Task:
<describe the exact task>

Definition of done:
<what must be true when finished>
```

## Template B: Strict Execution Mode

```text
Session mode: strict focused execution.

Bootstrap:
- `/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/SESSION_BOOTSTRAP.md`
- `/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/AGENTS.md`

Hard constraints:
1) No full-repo discovery unless I explicitly ask.
2) No architecture reinterpretation (this is web/SaaS track).
3) No tenant access shortcuts.
4) No "done" claim without checks or explicit blocker.
5) Update docs/changelog/backlog only if your changes affect them.

Work item:
- Backlog item: <id/title or "ad-hoc"> 
- Scope: <files/modules>
- Required checks: <build/lint/test/smoke or specific command>

Output format:
- What changed
- Why
- Checks run
- Residual risks / follow-ups
```

## Template C: Hotfix / Incident

```text
Hotfix mode.

Use `/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/SESSION_BOOTSTRAP.md`.
Do minimum safe change for this incident, avoid unrelated refactors.

Incident:
<symptom + where observed>

Expected fix:
<observable behavior after fix>

Verification:
<exact command(s) or manual flow>
```

## Fill-In Checklist Before Sending

- Is the task specific enough (component/route/job)?
- Is done criteria explicit?
- Are required checks named?
- Is scope constrained?
