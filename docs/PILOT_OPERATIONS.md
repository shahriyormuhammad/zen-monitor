# Pilot Operations

This document turns the current product surface into a real pilot operating model.

## Pilot Goal

The first pilot is not a generic analytics demo. It should prove three things:

- the team can detect margin-loss signals fast enough to act before they become stale;
- signal handling can be distributed across operators and owners without losing context;
- the workflow produces measurable operational and commercial outcomes.

## Core Roles

Recommended live pilot roles:

- `owner`: final decision-maker for price/content/stock actions and escalation resolution;
- `admin`: queue manager who owns shared presets, owner defaults, rebalance decisions, and SLA policy;
- `operator`: first-line triage, investigation, notes, and handoff execution.

Minimum staffing for one pilot tenant:

- `1` owner or admin who can make commercial decisions;
- `1-2` operators who run the queue every day.

## Working Queue Model

Use the built-in queue model as the actual operating system:

- `needs action`: first-line queue for new and active signals;
- `awaiting owner`: handoff queue for decisions that need owner/admin confirmation;
- `blocked`: queue waiting for sync, token fix, or external dependency;
- `overdue only`: SLA breach queue for direct escalation work.

Saved-view policy:

- one global `team default` for the tenant-wide fallback queue;
- one `owner default` per active owner queue if that owner has a stable operating preset;
- pin the two or three queues that the team opens every day;
- use `Selected to owner` for explicit handoff and `Balance N` only when one owner lane is measurably overloaded.

## Daily Pilot Cadence

Start with this cadence:

1. Morning health check
   - verify `/api/health`
   - verify the last sync result in `settings`
   - run manual sync if needed
2. Morning triage
   - open `team default`
   - clear `needs action`
   - assign or hand off every new/high-impact signal
3. Midday owner review
   - open `awaiting owner`
   - close, return, or comment every pending owner decision
4. End-of-day SLA sweep
   - open `overdue only`
   - resolve blocked overdue and overdue handoff items
   - inspect automation runs and follow-up outcomes

## KPIs To Track During Pilot

Operational KPIs:

- sync success rate per day;
- count of active overdue signals;
- count of overdue `handoff` and overdue `blocked` signals;
- first-action speed: time from signal creation to first note, assignment, or workflow change;
- reminder effectiveness: share of follow-up waves that move from `pending` to `progressed/resolved`.

Workload KPIs:

- signals currently assigned per owner queue;
- queue imbalance: delta between busiest and lightest owner lanes;
- count of manual rebalance actions per week;
- volume of signals sitting without owner.

Business KPIs:

- sum of `impactRub` on resolved signals;
- share of high/critical signals resolved within SLA;
- repeated-signal rate on the same SKU after a prior resolution;
- owner decision turnaround for `awaiting owner`.

## Success Criteria For The First Pilot

The first pilot can be called healthy if, over a stable 1-2 week window:

- manual sync and scheduled runtime stay operational without daily engineering intervention;
- shared queues are used as the team entry point instead of ad-hoc personal filtering;
- no critical signals stay invisible because of queue ownership ambiguity;
- overdue backlog trends down instead of accumulating;
- the team can point to at least a few concrete resolved signals with visible commercial impact.

## Weekly Review Checklist

Once per week, review:

- top repeated signal types;
- owner lanes with chronic overload;
- blocked reasons that should become product fixes;
- saved views that should become pinned or default queues;
- automation noise versus actual reminder value.

## Product Feedback To Capture During Pilot

Capture these questions every week:

- which signal types create action, and which only create noise;
- where operators still leave the product to coordinate outside the app;
- whether `owner default` presets actually match how owners work;
- whether rebalance suggestions are useful or too naive;
- what missing KPI or queue the team keeps recreating manually.
