import type { SignalQueueView, SignalSortPreset, SignalWorkflowState } from '@/lib/operator-signal-timeline';

export type SignalNoteTemplate = {
  id: string;
  label: string;
  body: string;
};

export type SignalHandoffPreset = {
  id: string;
  label: string;
  description: string;
  workflowState: SignalWorkflowState;
  noteBody: string;
};

export type SignalEscalationPreset = {
  id: string;
  label: string;
  description: string;
  workflowState: SignalWorkflowState;
  noteBody: string;
  sortPreset: SignalSortPreset;
};

export type SignalSlaQueuePreset = {
  id: string;
  label: string;
  description: string;
  savedViewName: string;
  queueView: SignalQueueView;
  workflowFilter: 'all' | SignalWorkflowState;
  sortPreset: SignalSortPreset;
};

export const SIGNAL_NOTE_TEMPLATES: SignalNoteTemplate[] = [
  {
    id: 'investigate',
    label: 'В работе',
    body: 'Взял сигнал в разбор. Проверяю цифры, источник отклонения и следующий операторский шаг.',
  },
  {
    id: 'owner-review',
    label: 'Нужен владелец',
    body: 'Нужно подтверждение владельца кабинета перед изменением цены, контента или остатков по этому сигналу.',
  },
  {
    id: 'need-resync',
    label: 'Нужен re-sync',
    body: 'Нужна повторная синхронизация и перепроверка raw-данных, прежде чем закрывать этот сигнал.',
  },
  {
    id: 'executing',
    label: 'Передано в исполнение',
    body: 'Передаю сигнал в исполнение. После внесения изменений зафиксируйте результат отдельным комментарием в timeline.',
  },
];

export const SIGNAL_HANDOFF_PRESETS: SignalHandoffPreset[] = [
  {
    id: 'handoff-owner',
    label: 'Handoff владельцу',
    description: 'Переводит сигнал в handoff и оставляет note про решение владельца кабинета.',
    workflowState: 'handoff',
    noteBody: 'Передаю сигнал владельцу кабинета: нужно принять решение и зафиксировать действие в timeline.',
  },
  {
    id: 'handoff-execution',
    label: 'Handoff в исполнение',
    description: 'Фиксирует передачу в handoff и добавляет note для исполнителя.',
    workflowState: 'handoff',
    noteBody: 'Передаю сигнал в исполнение. Нужна операционная отработка и обратная связь по итогам изменений.',
  },
  {
    id: 'blocked-sync',
    label: 'Blocked: нужен sync',
    description: 'Ставит сигнал в blocked и пишет, что нужно обновить данные или токен.',
    workflowState: 'blocked',
    noteBody: 'Сигнал переведён в blocked: сначала нужен повторный sync или проверка токена/источника данных.',
  },
];

export const SIGNAL_ESCALATION_PRESETS: SignalEscalationPreset[] = [
  {
    id: 'needs-action-priority',
    label: 'Эскалировать в разбор',
    description: 'Берёт сигнал в приоритетный разбор и просит дать апдейт в пределах текущей смены.',
    workflowState: 'in_progress',
    noteBody: 'SLA-эскалация: сигнал стареет в needs action. Беру в приоритетный разбор, нужен апдейт по решению в ближайшую смену.',
    sortPreset: 'sla_pressure',
  },
  {
    id: 'handoff-owner-overdue',
    label: 'Эскалировать owner handoff',
    description: 'Фиксирует overdue handoff и просит owner/admin вернуть решение по сигналу сегодня.',
    workflowState: 'handoff',
    noteBody: 'SLA-эскалация: handoff overdue. Нужен ответ owner/admin и фиксация следующего действия сегодня.',
    sortPreset: 'sla_pressure',
  },
  {
    id: 'blocked-overdue',
    label: 'Эскалировать blocker',
    description: 'Фиксирует overdue blocked и требует внешнего апдейта или решения по разблокировке.',
    workflowState: 'blocked',
    noteBody: 'SLA-эскалация: blocked overdue. Нужен внешний апдейт, решение по разблокировке или явный owner handoff.',
    sortPreset: 'sla_pressure',
  },
];

export const SIGNAL_SLA_QUEUE_PRESETS: SignalSlaQueuePreset[] = [
  {
    id: 'overdue-all',
    label: 'All overdue',
    description: 'Все сигналы, которые уже вышли за свой SLA, в одном приоритетном queue.',
    savedViewName: 'SLA: overdue queue',
    queueView: 'overdue_only',
    workflowFilter: 'all',
    sortPreset: 'sla_pressure',
  },
  {
    id: 'overdue-blocked',
    label: 'Blocked overdue',
    description: 'Только blocked-сигналы, у которых вышел SLA и нужен owner-level разбор.',
    savedViewName: 'SLA: blocked overdue',
    queueView: 'overdue_only',
    workflowFilter: 'blocked',
    sortPreset: 'sla_pressure',
  },
  {
    id: 'overdue-handoff',
    label: 'Handoff overdue',
    description: 'Только overdue handoff, где owner/admin ещё не вернул решение.',
    savedViewName: 'SLA: handoff overdue',
    queueView: 'overdue_only',
    workflowFilter: 'handoff',
    sortPreset: 'sla_pressure',
  },
];

export function isOwnerLikeTenantRole(role: string | null | undefined) {
  return role === 'owner' || role === 'admin';
}
