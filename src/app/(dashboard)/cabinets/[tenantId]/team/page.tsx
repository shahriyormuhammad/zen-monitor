'use client';

import { use, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  Loader2,
  MailCheck,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';
import { getTeamData, inviteMember, removeTeamMember, updateTeamMemberAccess } from '@/app/(dashboard)/cabinets/user-actions';
import { useStore } from '@/store/useStore';
import {
  permissionsForPreset,
  TENANT_ACCESS_PRESETS,
  TENANT_FEATURE_LABELS,
  TENANT_FEATURES,
  type TenantAccessPreset,
  type TenantFeaturePermissions,
} from '@/lib/auth/feature-access';

type TeamRole = 'owner' | 'admin' | 'manager' | 'viewer';
type InviteRole = Exclude<TeamRole, 'owner'>;

type TeamCollaborator = {
  id: string | null;
  email: string | null;
  role: string;
  accessPreset: TenantAccessPreset;
  featurePermissions: TenantFeaturePermissions;
  joinedAt: Date | string | null;
};

type PendingInvite = {
  id: string;
  email: string;
  role: string;
  accessPreset: TenantAccessPreset;
  featurePermissions: TenantFeaturePermissions;
  token: string;
  expiresAt: Date | string;
  createdAt: Date | string;
};

type TeamData = {
  tenant: {
    id: string;
    name: string | null;
    shopName: string | null;
  } | null | undefined;
  currentUserId: string;
  currentUserRole: TeamRole;
  collaborators: TeamCollaborator[];
  pendingInvites: PendingInvite[];
};

type FeedbackState = {
  tone: 'success' | 'error';
  text: string;
};

const roleOptions: Array<{ id: InviteRole; label: string; icon: LucideIcon; hint: string }> = [
  { id: 'admin', label: 'Админ', icon: Shield, hint: 'Все разделы, кроме передачи владения.' },
  { id: 'manager', label: 'Менеджер', icon: Users, hint: 'Рабочие разделы по выбранному профилю.' },
  { id: 'viewer', label: 'Наблюдатель', icon: Eye, hint: 'Минимальный обзор без операций.' },
];

const roleLabels: Record<TeamRole, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
};

const roleBadgeTone: Record<TeamRole, string> = {
  owner: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/40',
  admin: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800/40',
  manager: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/40',
  viewer: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
};

const accessPresetOptions: TenantAccessPreset[] = [
  'advertising_manager',
  'supply_manager',
  'finance_manager',
  'support_manager',
  'analyst',
  'viewer',
  'custom',
];

function summarizePermissions(permissions: TenantFeaturePermissions) {
  return TENANT_FEATURES
    .filter((feature) => permissions[feature])
    .map((feature) => TENANT_FEATURE_LABELS[feature]);
}

const feedbackTone: Record<FeedbackState['tone'], string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200',
  error: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300',
};

function formatDate(value: Date | string | null) {
  if (!value) {
    return 'Дата не зафиксирована';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value instanceof Date ? value : new Date(value));
}

function getTenantLabel(team: TeamData | undefined, fallbackTenantId: string) {
  if (team?.tenant?.shopName) {
    return team.tenant.shopName;
  }

  if (team?.tenant?.name) {
    return team.tenant.name;
  }

  return `${fallbackTenantId.slice(0, 8)}...`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function TeamPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = use(params);
  const queryClient = useQueryClient();
  const { userRole } = useStore();

  const [isInviting, setIsInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('manager');
  const [accessPreset, setAccessPreset] = useState<TenantAccessPreset>('advertising_manager');
  const [featurePermissions, setFeaturePermissions] = useState<TenantFeaturePermissions>(
    permissionsForPreset('advertising_manager'),
  );
  const [editingMember, setEditingMember] = useState<TeamCollaborator | null>(null);
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const {
    data: team,
    isLoading,
    error,
    refetch,
  } = useQuery<TeamData, Error>({
    queryKey: ['team', tenantId],
    queryFn: () => getTeamData(tenantId),
  });

  const effectiveRole = team?.currentUserRole ?? userRole;
  const canInvite = effectiveRole === 'owner' || effectiveRole === 'admin';
  const canRemoveMembers = effectiveRole === 'owner';
  const tenantLabel = getTenantLabel(team, tenantId);

  const collaborators = useMemo(() => {
    const order: Record<TeamRole, number> = { owner: 0, admin: 1, manager: 2, viewer: 3 };
    return [...(team?.collaborators ?? [])].sort((left, right) => {
      const leftRole = (left.role as TeamRole) in order ? order[left.role as TeamRole]! : 99;
      const rightRole = (right.role as TeamRole) in order ? order[right.role as TeamRole]! : 99;

      if (leftRole !== rightRole) {
        return leftRole - rightRole;
      }

      const leftDate = left.joinedAt ? new Date(left.joinedAt).getTime() : 0;
      const rightDate = right.joinedAt ? new Date(right.joinedAt).getTime() : 0;
      return leftDate - rightDate;
    });
  }, [team?.collaborators]);

  const pendingInvites = team?.pendingInvites ?? [];

  const inviteMutation = useMutation({
    mutationFn: (data: {
      email: string;
      role: InviteRole;
      accessPreset: TenantAccessPreset;
      featurePermissions: TenantFeaturePermissions;
    }) => inviteMember(tenantId, data.email, data.role, data.accessPreset, data.featurePermissions),
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: (result) => {
      setLastToken(result.token);
      setFeedback({
        tone: 'success',
        text: 'Инвайт создан. Скопируйте ссылку и отправьте её коллеге.',
      });
      queryClient.invalidateQueries({ queryKey: ['team', tenantId] });
      setEmail('');
    },
    onError: (mutationError) => {
      setFeedback({
        tone: 'error',
        text: getErrorMessage(mutationError, 'Не удалось создать приглашение'),
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (data: { id: string; isInvite: boolean }) => removeTeamMember(tenantId, data.id, data.isInvite),
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: (_, variables) => {
      setFeedback({
        tone: 'success',
        text: variables.isInvite ? 'Приглашение отозвано.' : 'Участник удалён из кабинета.',
      });
      queryClient.invalidateQueries({ queryKey: ['team', tenantId] });
    },
    onError: (mutationError) => {
      setFeedback({
        tone: 'error',
        text: getErrorMessage(mutationError, 'Не удалось обновить состав команды'),
      });
    },
  });

  const updateAccessMutation = useMutation({
    mutationFn: (data: {
      userId: string;
      role: InviteRole;
      accessPreset: TenantAccessPreset;
      featurePermissions: TenantFeaturePermissions;
    }) => updateTeamMemberAccess(tenantId, data.userId, {
      role: data.role,
      accessPreset: data.accessPreset,
      featurePermissions: data.featurePermissions,
    }),
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: () => {
      setFeedback({
        tone: 'success',
        text: 'Доступ участника обновлён.',
      });
      setEditingMember(null);
      queryClient.invalidateQueries({ queryKey: ['team', tenantId] });
    },
    onError: (mutationError) => {
      setFeedback({
        tone: 'error',
        text: getErrorMessage(mutationError, 'Не удалось обновить доступ участника'),
      });
    },
  });

  const openInviteModal = () => {
    setFeedback(null);
    setEmail('');
    setRole('manager');
    setAccessPreset('advertising_manager');
    setFeaturePermissions(permissionsForPreset('advertising_manager'));
    setLastToken(null);
    setIsInviting(true);
  };

  const closeInviteModal = () => {
    setIsInviting(false);
    setLastToken(null);
  };

  const applyRole = (nextRole: InviteRole) => {
    setRole(nextRole);
    if (nextRole === 'admin') {
      setAccessPreset('all');
      setFeaturePermissions(permissionsForPreset('all'));
      return;
    }
    if (nextRole === 'viewer') {
      setAccessPreset('viewer');
      setFeaturePermissions(permissionsForPreset('viewer'));
      return;
    }

    setAccessPreset('advertising_manager');
    setFeaturePermissions(permissionsForPreset('advertising_manager'));
  };

  const applyPreset = (nextPreset: TenantAccessPreset) => {
    setAccessPreset(nextPreset);
    if (nextPreset !== 'custom') {
      setFeaturePermissions(permissionsForPreset(nextPreset));
    }
  };

  const toggleFeature = (feature: keyof TenantFeaturePermissions) => {
    setAccessPreset('custom');
    setFeaturePermissions((current) => ({
      ...current,
      [feature]: !current[feature],
    }));
  };

  const openEditMember = (member: TeamCollaborator) => {
    const normalizedRole = (member.role as TeamRole) in roleLabels ? (member.role as TeamRole) : 'viewer';
    if (normalizedRole === 'owner') {
      return;
    }
    setEditingMember(member);
    setRole(normalizedRole === 'admin' ? 'admin' : normalizedRole === 'manager' ? 'manager' : 'viewer');
    setAccessPreset(member.accessPreset ?? 'custom');
    setFeaturePermissions(member.featurePermissions);
    setLastToken(null);
    setFeedback(null);
  };

  const copyInviteLink = async (token: string) => {
    try {
      const link = `${window.location.origin}/invite/${token}`;
      await navigator.clipboard.writeText(link);
      setFeedback({
        tone: 'success',
        text: 'Ссылка приглашения скопирована в буфер обмена.',
      });
    } catch {
      setFeedback({
        tone: 'error',
        text: 'Не удалось скопировать ссылку автоматически. Скопируйте её вручную.',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-slate-500 dark:text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-sm font-medium">Загружаем текущий состав команды и активные приглашения...</p>
      </div>
    );
  }

  if (error) {
    return (
      <OperatorState
        icon={Users}
        tone="danger"
        title="Не удалось загрузить команду"
        description={error.message}
        actionLabel="Повторить запрос"
        action={refetch}
      />
    );
  }

  if (!team) {
    return (
      <OperatorState
        icon={Users}
        tone="warning"
        title="Команда кабинета недоступна"
        description="Сервер не вернул информацию о кабинете. Проверьте доступ и попробуйте снова."
        actionLabel="Вернуться в настройки"
        actionHref="/settings"
      />
    );
  }

  return (
    <div className="max-w-5xl animate-in fade-in slide-in-from-bottom-2 duration-500 pb-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/settings"
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-100"
            title="Вернуться в настройки"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Кабинет: <span className="font-bold text-slate-700">{tenantLabel}</span>
          </p>
        </div>

        {canInvite ? (
          <button
            onClick={openInviteModal}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition-all hover:bg-slate-800 active:scale-95"
          >
            <UserPlus className="h-4 w-4" />
            Пригласить коллегу
          </button>
        ) : null}
      </div>

      {feedback ? (
        <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm font-medium ${feedbackTone[feedback.tone]}`}>
          {feedback.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="overflow-hidden rounded-[2rem] border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
            <div className="border-b border-slate-50 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/50 p-6">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                <Users className="h-4 w-4 text-emerald-500" />
                Активные участники
              </h3>
            </div>

            {collaborators.length > 0 ? (
              <div className="divide-y divide-slate-50 dark:divide-slate-700/30">
                {collaborators.map((member) => {
                  const normalizedRole = (member.role as TeamRole) in roleLabels
                    ? (member.role as TeamRole)
                    : 'viewer';
                  const memberPermissions = summarizePermissions(member.featurePermissions);
                  const isCurrentUser = member.id === team.currentUserId;
                  const canRemoveMember =
                    canRemoveMembers &&
                    Boolean(member.id) &&
                    member.id !== team.currentUserId &&
                    normalizedRole !== 'owner';

                  return (
                    <div key={member.id ?? `${member.role}-${String(member.joinedAt)}`} className="group flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-700/20">
                      <div className="flex items-center gap-4">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold text-sm ${
                          normalizedRole === 'owner' ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                        }`}>
                          {normalizedRole === 'owner' ? <Shield className="h-5 w-5" /> : (member.id?.slice(0, 2).toUpperCase() || '??')}
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                            <span className="text-slate-700 dark:text-slate-300">{member.email ?? `ID: ${member.id?.slice(0, 8) || 'unknown'}...`}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleBadgeTone[normalizedRole]}`}>
                              {roleLabels[normalizedRole]}
                            </span>
                            {isCurrentUser ? (
                              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300">
                                Вы
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                            В кабинете с {formatDate(member.joinedAt)}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(normalizedRole === 'owner' || normalizedRole === 'admin'
                              ? ['Все разделы']
                              : memberPermissions.slice(0, 4)
                            ).map((label) => (
                              <span key={`${member.id}-${label}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                                {label}
                              </span>
                            ))}
                            {memberPermissions.length > 4 && normalizedRole !== 'admin' && normalizedRole !== 'owner' ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                                +{memberPermissions.length - 4}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {canRemoveMembers && member.id && member.id !== team.currentUserId && normalizedRole !== 'owner' ? (
                          <button
                            type="button"
                            onClick={() => openEditMember(member)}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-bold text-slate-600 opacity-0 transition-all hover:bg-slate-50 group-hover:opacity-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            Доступ
                          </button>
                        ) : null}
                        {canRemoveMember ? (
                          <button
                            onClick={() => member.id && removeMutation.mutate({ id: member.id, isInvite: false })}
                            disabled={removeMutation.isPending}
                            className="rounded-xl p-2.5 text-slate-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Удалить из кабинета"
                          >
                            <Trash2 className="h-4.5 w-4.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-sm font-medium text-slate-500">
                У этого кабинета пока нет участников кроме текущего пользователя.
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
            <div className="border-b border-slate-50 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/50 p-6">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                <Clock3 className="h-4 w-4 text-blue-500" />
                Ожидают принятия
              </h3>
            </div>

            {pendingInvites.length > 0 ? (
              <div className="divide-y divide-slate-50 dark:divide-slate-700/30">
                {pendingInvites.map((invite) => (
                  <div key={invite.id} className="group flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-700/20">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-500 dark:bg-blue-900/20 dark:text-blue-400">
                        <MailCheck className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-800">{invite.email}</div>
                        <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                          {roleLabels[(invite.role as TeamRole) in roleLabels ? (invite.role as TeamRole) : 'viewer']} • {TENANT_ACCESS_PRESETS[invite.accessPreset]?.label ?? 'Индивидуально'} • Истекает {formatDate(invite.expiresAt)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {canInvite ? (
                        <button
                          onClick={() => copyInviteLink(invite.token)}
                          className="rounded-lg p-2 text-slate-400 transition-all hover:bg-emerald-50 hover:text-emerald-600"
                          title="Скопировать ссылку"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      ) : null}
                      {canRemoveMembers ? (
                        <button
                          onClick={() => removeMutation.mutate({ id: invite.id, isInvite: true })}
                          disabled={removeMutation.isPending}
                          className="rounded-xl p-2.5 text-slate-300 transition-all hover:bg-rose-50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Отозвать приглашение"
                        >
                          <Trash2 className="h-4.5 w-4.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-sm font-medium text-slate-500">
                Активных приглашений сейчас нет. Новые инвайты появятся здесь сразу после создания.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50/50 p-8 dark:border-emerald-800/40 dark:bg-emerald-900/20">
            <h4 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
              <Shield className="h-4 w-4" />
              Уровни доступа
            </h4>

            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Владелец
                </div>
                <p className="text-[11px] font-medium leading-relaxed text-emerald-600/80">
                  Полный доступ к данным, ключам и управлению командой. Только владелец может отзывать приглашения и удалять участников.
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Администратор
                </div>
                <p className="text-[11px] font-medium leading-relaxed text-emerald-600/80">
                  Полный рабочий доступ и создание приглашений без передачи владения.
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Менеджер
                </div>
                <p className="text-[11px] font-medium leading-relaxed text-emerald-600/80">
                  Доступ только к выбранным функциям: реклама, склад, финансы, поддержка или custom-набор.
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Наблюдатель
                </div>
                <p className="text-[11px] font-medium leading-relaxed text-emerald-600/80">
                  Доступ только на чтение дашбордов, таблиц и аналитики без изменений настроек или состава команды.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ваш текущий уровень</p>
            <p className="mt-2 text-lg font-bold text-slate-800">
              {effectiveRole ? roleLabels[effectiveRole] : 'Не определён'}
            </p>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Проверяйте состав команды отсюда, а в настройки кабинета возвращайтесь через стрелку слева сверху.
            </p>
          </div>
        </div>
      </div>

      {isInviting ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-lg overflow-hidden rounded-[2.5rem] bg-white dark:bg-slate-800 shadow-2xl dark:shadow-slate-900 animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between p-8 pb-0">
              <div className="flex items-center gap-4">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-800">
                  <UserPlus className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Пригласить коллегу</h3>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Доступ к кабинету {tenantLabel}</p>
                </div>
              </div>
              <button onClick={closeInviteModal} aria-label="Закрыть" className="p-2 text-slate-300 transition-colors hover:text-slate-600">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-6 p-8">
              {lastToken ? (
                <div className="animate-in slide-in-from-bottom-2 space-y-4 duration-300">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-6 text-center dark:border-emerald-800/40 dark:bg-emerald-900/20">
                    <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
                    <h4 className="text-lg font-bold text-emerald-800">Приглашение создано</h4>
                    <p className="mt-1 text-xs font-medium text-emerald-600">Ссылка активна 48 часов. Скопируйте её и отправьте коллеге.</p>
                  </div>

                  <div className="relative">
                    <input
                      readOnly
                      value={`${window.location.origin}/invite/${lastToken}`}
                      className="w-full rounded-xl border border-slate-100 bg-slate-50 p-4 pr-12 font-mono text-sm text-slate-500"
                    />
                    <button
                      onClick={() => copyInviteLink(lastToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-emerald-600 transition-all hover:bg-white dark:hover:bg-slate-700"
                    >
                      <Copy className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      onClick={() => copyInviteLink(lastToken)}
                      className="rounded-2xl bg-emerald-600 py-4 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
                    >
                      Скопировать ссылку
                    </button>
                    <button
                      onClick={() => {
                        setLastToken(null);
                        setEmail('');
                        applyRole('manager');
                      }}
                      className="rounded-2xl border border-slate-200 py-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Создать ещё одно
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-2 ml-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Email коллеги</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="manager@example.com"
                      className="w-full rounded-2xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-5 py-4 font-medium text-slate-700 dark:text-slate-300 transition-all focus:bg-white dark:focus:bg-slate-700 focus:outline-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="mb-3 ml-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Роль в кабинете</label>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {roleOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => applyRole(option.id)}
                          className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all ${
                            role === option.id ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/20' : 'border-slate-100 bg-slate-50 hover:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <option.icon className={`h-4 w-4 ${role === option.id ? 'text-emerald-600' : 'text-slate-400'}`} />
                            <span className={`text-sm font-bold ${role === option.id ? 'text-emerald-700' : 'text-slate-600'}`}>
                              {option.label}
                            </span>
                          </span>
                          <span className="text-[11px] font-medium leading-relaxed text-slate-500">{option.hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {role !== 'admin' ? (
                    <div className="space-y-4">
                      <div>
                        <label className="mb-3 ml-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Что будет видеть пользователь</label>
                        <div className="grid grid-cols-1 gap-2">
                          {accessPresetOptions.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => applyPreset(preset)}
                              className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                                accessPreset === preset
                                  ? 'border-blue-500 bg-blue-50/70 dark:border-blue-800/50 dark:bg-blue-900/20'
                                  : 'border-slate-100 bg-slate-50 hover:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800'
                              }`}
                            >
                              <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{TENANT_ACCESS_PRESETS[preset].label}</div>
                              <div className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">{TENANT_ACCESS_PRESETS[preset].description}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {accessPreset === 'custom' ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {TENANT_FEATURES.map((feature) => (
                            <label
                              key={feature}
                              className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
                            >
                              <span>{TENANT_FEATURE_LABELS[feature]}</span>
                              <input
                                type="checkbox"
                                checked={featurePermissions[feature]}
                                onChange={() => toggleFeature(feature)}
                                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <button
                    onClick={() => inviteMutation.mutate({ email, role, accessPreset, featurePermissions })}
                    disabled={!email || inviteMutation.isPending}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-[1.5rem] bg-emerald-600 py-5 font-bold text-white shadow-xl shadow-emerald-600/20 transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50"
                  >
                    {inviteMutation.isPending ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Создание...
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-5 w-5" />
                        Создать приглашение
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editingMember ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-2xl overflow-hidden rounded-[2rem] bg-white shadow-2xl dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 p-6 dark:border-slate-700">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Настроить доступ</h3>
                <p className="mt-1 text-xs font-medium text-slate-500">{editingMember.email ?? editingMember.id}</p>
              </div>
              <button onClick={() => setEditingMember(null)} aria-label="Закрыть" className="p-2 text-slate-300 transition-colors hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[72vh] space-y-5 overflow-y-auto p-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {roleOptions.map((option) => (
                  <button
                    key={`edit-${option.id}`}
                    type="button"
                    onClick={() => applyRole(option.id)}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      role === option.id ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/20' : 'border-slate-100 bg-slate-50 hover:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                      <option.icon className="h-4 w-4" />
                      {option.label}
                    </div>
                    <div className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">{option.hint}</div>
                  </button>
                ))}
              </div>

              {role !== 'admin' ? (
                <>
                  <div className="grid grid-cols-1 gap-2">
                    {accessPresetOptions.map((preset) => (
                      <button
                        key={`edit-preset-${preset}`}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                          accessPreset === preset
                            ? 'border-blue-500 bg-blue-50/70 dark:border-blue-800/50 dark:bg-blue-900/20'
                            : 'border-slate-100 bg-slate-50 hover:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{TENANT_ACCESS_PRESETS[preset].label}</div>
                        <div className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">{TENANT_ACCESS_PRESETS[preset].description}</div>
                      </button>
                    ))}
                  </div>

                  {accessPreset === 'custom' ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {TENANT_FEATURES.map((feature) => (
                        <label
                          key={`edit-${feature}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
                        >
                          <span>{TENANT_FEATURE_LABELS[feature]}</span>
                          <input
                            type="checkbox"
                            checked={featurePermissions[feature]}
                            onChange={() => toggleFeature(feature)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 p-6 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => editingMember.id && updateAccessMutation.mutate({
                  userId: editingMember.id,
                  role,
                  accessPreset,
                  featurePermissions,
                })}
                disabled={!editingMember.id || updateAccessMutation.isPending}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {updateAccessMutation.isPending ? 'Сохранение...' : 'Сохранить доступ'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
