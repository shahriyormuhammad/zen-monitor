import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES,
  resolveSignalNotificationPreferenceKey,
  resolveSignalNotificationPreferences,
  resolveSignalQueueView,
  resolveSignalSavedViewScope,
  resolveSignalWorkflowState,
} from "@/lib/operator-signal-timeline";

describe("operator signal timeline helpers", () => {
  it("resolves workflow, queue, and scope guards safely", () => {
    expect(resolveSignalWorkflowState("handoff")).toBe("handoff");
    expect(resolveSignalWorkflowState("broken")).toBeNull();
    expect(resolveSignalQueueView("overdue_only")).toBe("overdue_only");
    expect(resolveSignalQueueView("wrong")).toBeNull();
    expect(resolveSignalSavedViewScope("team")).toBe("team");
    expect(resolveSignalSavedViewScope("owner")).toBeNull();
  });

  it("falls back to default notification preferences for invalid payloads", () => {
    expect(resolveSignalNotificationPreferences(null)).toEqual(DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES);
    expect(resolveSignalNotificationPreferences("bad-payload")).toEqual(DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES);
  });

  it("inherits the legacy note preference for automation when the key is missing", () => {
    expect(resolveSignalNotificationPreferences({
      note: false,
      assignment: true,
      blocked: true,
    })).toEqual({
      note: false,
      assignment: true,
      blocked: true,
      automation: false,
    });
  });

  it("routes automation notes into the automation preference channel", () => {
    expect(resolveSignalNotificationPreferenceKey("note", {
      automation: "sla_follow_up",
    })).toBe("automation");
    expect(resolveSignalNotificationPreferenceKey("note", {
      automation: "manual",
    })).toBe("note");
  });

  it("routes blocked workflow transitions into the blocked preference channel", () => {
    expect(resolveSignalNotificationPreferenceKey("workflow_state", {
      workflowState: "blocked",
    })).toBe("blocked");
    expect(resolveSignalNotificationPreferenceKey("workflow_state", {
      workflowState: "handoff",
    })).toBeNull();
  });
});
