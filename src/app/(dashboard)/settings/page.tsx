'use client';

import { useCallback, useState, useEffect } from 'react';
import { useStore, type UserRole } from '@/store/useStore';
import { 
  AlertTriangle, Bell, Bot, CheckCircle2, ChevronDown, KeyRound, RefreshCw, ShieldCheck, Store, Percent,
  Settings2, LayoutGrid, Plus, Users
} from 'lucide-react';
import { SyncButton } from './SyncButton';
import { WbLkAuthFlow } from './WbLkAuthFlow';
import { PasswordSettingsCard } from './PasswordSettingsCard';
import { CsvUpload } from '@/components/dashboard/CsvUpload';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';

import { 
  saveApiToken, updateTenantSettings, getTenantSettings,
  getAvailableTenants, addCabinet, switchActiveTenant, updateInAppSignalNotificationPreferences, validateWbToken,
  createTelegramLinkToken,
  type StoredWbTokenHealth,
  type TelegramLinkState,
  type TelegramLinkTokenResult,
  type WbTokenPreflightResult,
  type WbLkSessionHealth,
} from './actions';
import {
  DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES,
  type SignalNotificationPreferenceKey,
  type SignalNotificationPreferences,
} from '@/lib/operator-signal-timeline';
import {
  VAT_MODES,
  WB_TAX_REGIMES,
  getTaxRegimeDefinition,
  getVatModeDefinition,
  normalizeVatMode,
  normalizeWbTaxType,
  resolveTaxRatePercent,
  resolveVatRatePercent,
} from '@/lib/tax/regimes';
import type { TenantFeaturePermissions } from '@/lib/auth/feature-access';

type SettingsFormData = {
  shopName: string;
  taxType: string;
  taxRate: number;
  vatMode: string;
  vatRate: number;
  wbLkPhone: string | null;
  telegramChatId: number | null;
  notificationsEnabled: boolean;
  telegramSignalNotificationPrefs: SignalNotificationPreferences;
};

type CabinetSummary = {
  id: string | null;
  name: string | null;
  shopName: string | null;
  role: string;
  accessPreset: string | null;
  featurePermissions: TenantFeaturePermissions;
  hasStoredToken: boolean;
  wbTokenHealthStatus: 'unknown' | 'healthy' | 'warning' | 'invalid' | null;
  wbTokenCheckedAt: Date | null;
  wbLkSessionStatus: 'unknown' | 'healthy' | 'warning' | 'invalid' | null;
};

type TokenPreflightCheck = {
  key: string;
  label: string;
  ok: boolean;
  category: string;
  message: string;
  statusCode?: number;
};

type TokenFeedback = {
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  checkedAt?: string;
  source?: 'draft' | 'stored';
  checks?: TokenPreflightCheck[];
};

const SIGNAL_NOTIFICATION_FIELDS: Array<{
  key: SignalNotificationPreferenceKey;
  label: string;
  description: string;
}> = [
  {
    key: 'note',
    label: 'Комментарии',
    description: 'Когда в сигнале появился новый комментарий.',
  },
  {
    key: 'assignment',
    label: 'Назначения',
    description: 'Сообщать, когда сигнал переназначили или сняли ответственного.',
  },
  {
    key: 'blocked',
    label: 'Блокеры',
    description: 'Когда сигнал переведён в статус блокера.',
  },
  {
    key: 'automation',
    label: 'Автоматизация и SLA',
    description: 'Напоминания, эскалации и итоги автоматических проверок.',
  },
];

const TOKEN_CHECK_LABELS: Record<string, string> = {
  statistics: 'Статистика',
  content: 'Контент',
  prices: 'Цены',
  ads: 'Реклама',
  'Statistics API': 'Статистика',
  'Content API': 'Контент',
  'Prices API': 'Цены',
  'Advertising API': 'Реклама',
};

const getTokenCheckLabel = (check: Pick<TokenPreflightCheck, 'key' | 'label'>) =>
  TOKEN_CHECK_LABELS[check.key] ?? TOKEN_CHECK_LABELS[check.label] ?? check.label;

const buildTokenFeedback = (
  result: WbTokenPreflightResult,
  overrides?: Partial<Pick<TokenFeedback, 'tone' | 'title' | 'message' | 'source'>>
): TokenFeedback => ({
  tone: overrides?.tone ?? (result.ok ? 'success' : result.healthStatus === 'invalid' ? 'error' : 'warning'),
  title: overrides?.title ?? result.title,
  message: overrides?.message ?? result.message,
  checkedAt: result.checkedAt,
  source: overrides?.source ?? result.source,
  checks: result.checks,
});

const getStoredTokenHealthView = (hasStoredToken: boolean, tokenHealth: StoredWbTokenHealth | null) => {
  if (!hasStoredToken) {
    return {
      tone: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300',
      badgeTone: 'border-slate-200 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400',
      badgeLabel: 'Не сохранён',
      title: 'Сохранённый токен отсутствует',
      message: 'Сначала сохраните токен кабинета, затем подтвердите его через preflight.',
      checkedAt: null,
    };
  }

  if (!tokenHealth) {
    return {
      tone: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-200',
      badgeTone: 'border-blue-200 bg-white text-blue-700 dark:border-blue-800/40 dark:bg-slate-800 dark:text-blue-300',
      badgeLabel: 'Не проверен',
      title: 'Сохранённый токен ещё не проходил проверку',
      message: 'Запустите preflight по сохранённому токену, чтобы получить последнее подтверждённое состояние.',
      checkedAt: null,
    };
  }

  if (tokenHealth.status === 'healthy') {
    return {
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200',
      badgeTone: 'border-emerald-200 bg-white text-emerald-700 dark:border-emerald-800/40 dark:bg-slate-800 dark:text-emerald-300',
      badgeLabel: 'Подтверждён',
      title: tokenHealth.title,
      message: tokenHealth.message,
      checkedAt: tokenHealth.checkedAt,
    };
  }

  if (tokenHealth.status === 'unknown') {
    return {
      tone: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-200',
      badgeTone: 'border-blue-200 bg-white text-blue-700 dark:border-blue-800/40 dark:bg-slate-800 dark:text-blue-300',
      badgeLabel: 'Проверяется',
      title: tokenHealth.title,
      message: tokenHealth.message,
      checkedAt: tokenHealth.checkedAt,
    };
  }

  if (tokenHealth.status === 'invalid') {
    return {
      tone: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200',
      badgeTone: 'border-rose-200 bg-white text-rose-700 dark:border-rose-800/40 dark:bg-slate-800 dark:text-rose-300',
      badgeLabel: 'Проблемный',
      title: tokenHealth.title,
      message: tokenHealth.message,
      checkedAt: tokenHealth.checkedAt,
    };
  }

  return {
    tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200',
    badgeTone: 'border-amber-200 bg-white text-amber-700 dark:border-amber-800/40 dark:bg-slate-800 dark:text-amber-300',
    badgeLabel: 'С предупреждением',
    title: tokenHealth.title,
    message: tokenHealth.message,
    checkedAt: tokenHealth.checkedAt,
  };
};

const getCabinetTokenBadge = (cabinet: Pick<CabinetSummary, 'hasStoredToken' | 'wbTokenHealthStatus'>) => {
  if (!cabinet.hasStoredToken) {
    return {
      tone: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
      label: 'Без токена',
    };
  }

  if (cabinet.wbTokenHealthStatus === 'healthy') {
    return {
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300',
      label: 'Токен OK',
    };
  }

  if (cabinet.wbTokenHealthStatus === 'invalid') {
    return {
      tone: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300',
      label: 'Токен проблемный',
    };
  }

  if (cabinet.wbTokenHealthStatus === 'warning') {
    return {
      tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300',
      label: 'Токен с риском',
    };
  }

  return {
    tone: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300',
    label: 'Токен не проверен',
  };
};

const getWbLkSessionHealthView = (sessionHealth: WbLkSessionHealth | null) => {
  if (!sessionHealth) {
    return {
      tone: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300',
      badgeTone: 'border-slate-200 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400',
      badgeLabel: 'Не настроено',
      title: 'WB ЛК доступ не настроен',
      message: 'Добавьте номер и выполните проверку входа по SMS.',
      checkedAt: null,
    };
  }

  if (sessionHealth.status === 'healthy') {
    return {
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200',
      badgeTone: 'border-emerald-200 bg-white text-emerald-700 dark:border-emerald-800/40 dark:bg-slate-800 dark:text-emerald-300',
      badgeLabel: 'Подтверждено',
      title: sessionHealth.title,
      message: sessionHealth.message,
      checkedAt: sessionHealth.checkedAt,
    };
  }

  if (sessionHealth.status === 'warning') {
    return {
      tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200',
      badgeTone: 'border-amber-200 bg-white text-amber-700 dark:border-amber-800/40 dark:bg-slate-800 dark:text-amber-300',
      badgeLabel: 'Нужен SMS',
      title: sessionHealth.title,
      message: sessionHealth.message,
      checkedAt: sessionHealth.checkedAt,
    };
  }

  if (sessionHealth.status === 'invalid') {
    return {
      tone: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200',
      badgeTone: 'border-rose-200 bg-white text-rose-700 dark:border-rose-800/40 dark:bg-slate-800 dark:text-rose-300',
      badgeLabel: 'Ошибка',
      title: sessionHealth.title,
      message: sessionHealth.message,
      checkedAt: sessionHealth.checkedAt,
    };
  }

  return {
    tone: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300',
    badgeTone: 'border-slate-200 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400',
    badgeLabel: 'Не проверено',
    title: sessionHealth.title,
    message: sessionHealth.message,
    checkedAt: sessionHealth.checkedAt,
  };
};

const formatCheckedAt = (value?: string) => {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

export default function SettingsPage() {
  const { tenantId, setTenantId, setUserRole, setFeaturePermissions, setNeedsTenantSetup, needsTenantSetup } = useStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'current' | 'all'>('current');
  const resolvedTab = tenantId ? activeTab : 'all';

  // --- CURRENT TENANT SETTINGS STATE ---
  const [token, setToken] = useState('');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'loading' | 'saved' | 'warning' | 'error'>('idle');
  const [tokenFeedback, setTokenFeedback] = useState<TokenFeedback | null>(null);
  const [storedTokenHealth, setStoredTokenHealth] = useState<StoredWbTokenHealth | null>(null);
  const [hasStoredToken, setHasStoredToken] = useState(false);
  const [warningSaveAvailable, setWarningSaveAvailable] = useState(false);
  const [wbLkPhone, setWbLkPhone] = useState('');
  const [savedWbLkPhone, setSavedWbLkPhone] = useState<string | null>(null);
  const [wbLkSessionHealth, setWbLkSessionHealth] = useState<WbLkSessionHealth | null>(null);
  const [shopName, setShopName] = useState('');
  const [taxType, setTaxType] = useState('usn_income');
  const [taxRate, setTaxRate] = useState(6);
  const [vatMode, setVatMode] = useState('none');
  const [vatRate, setVatRate] = useState(0);
  const [tgChatId, setTgChatId] = useState('');
  const [telegramActiveLink, setTelegramActiveLink] = useState<TelegramLinkState | null>(null);
  const [telegramLinkToken, setTelegramLinkToken] = useState<TelegramLinkTokenResult | null>(null);
  const [telegramLinkMessage, setTelegramLinkMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [telegramSignalNotificationPrefs, setTelegramSignalNotificationPrefs] = useState<SignalNotificationPreferences>(DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES);
  const [inAppSignalNotificationPrefs, setInAppSignalNotificationPrefs] = useState<SignalNotificationPreferences>(DEFAULT_SIGNAL_NOTIFICATION_PREFERENCES);
  const [taxExpanded, setTaxExpanded] = useState(false);
  const [tokenExpanded, setTokenExpanded] = useState(true);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);

  // --- ALL CABINETS MANAGEMENT STATE ---
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [newCabinetFeedback, setNewCabinetFeedback] = useState<TokenFeedback | null>(null);
  const [newCabinetWarningAvailable, setNewCabinetWarningAvailable] = useState(false);

  const resetNewCabinetState = () => {
    setIsAdding(false);
    setNewName('');
    setNewToken('');
    setNewCabinetFeedback(null);
    setNewCabinetWarningAvailable(false);
  };

  const openNewCabinetModal = () => {
    setNewName('');
    setNewToken('');
    setNewCabinetFeedback(null);
    setNewCabinetWarningAvailable(false);
    setIsAdding(true);
  };

  const applyTenantSettings = useCallback((data: Awaited<ReturnType<typeof getTenantSettings>>) => {
    if (!data) {
      return;
    }

    setShopName(data.shopName || '');
    const normalizedTaxType = normalizeWbTaxType(data.taxType);
    setTaxType(normalizedTaxType);
    setTaxRate(resolveTaxRatePercent(normalizedTaxType, data.taxRate ?? null));
    const normalizedVatMode = normalizeVatMode(data.vatMode);
    setVatMode(normalizedVatMode);
    setVatRate(resolveVatRatePercent(normalizedVatMode, data.vatRate ?? null));
    setTelegramActiveLink(data.telegramLink ?? null);
    setTgChatId(data.telegramLink?.chatId?.toString() || data.telegramChatId?.toString() || '');
    setTelegramLinkToken(null);
    setTelegramLinkMessage(null);
    setNotificationsEnabled(data.notificationsEnabled);
    setTelegramSignalNotificationPrefs(data.signalNotificationSettings.telegram);
    setInAppSignalNotificationPrefs(data.signalNotificationSettings.inApp);
    setHasStoredToken(data.hasStoredToken);
    setStoredTokenHealth(data.tokenHealth);
    setSavedWbLkPhone(data.wbLkPhone ?? null);
    setWbLkPhone('');
    setWbLkSessionHealth(data.wbLkSessionHealth);
  }, []);

  const refreshTenantSettings = useCallback(async () => {
    if (!tenantId) {
      return;
    }

    applyTenantSettings(await getTenantSettings(tenantId));
  }, [applyTenantSettings, tenantId]);

  // 1. Load active tenant settings
  useEffect(() => {
    if (!tenantId) {
      return;
    }

    void getTenantSettings(tenantId).then(applyTenantSettings);
  }, [applyTenantSettings, tenantId]);

  // 2. Load all available cabinets
  const { data: cabinets = [] } = useQuery<CabinetSummary[]>({
    queryKey: ['available-tenants'],
    queryFn: () => getAvailableTenants(),
  });
  const validCabinets = cabinets.filter((cabinet): cabinet is CabinetSummary & { id: string } => Boolean(cabinet.id));

  // mutations
  const settingsMutation = useMutation({
    mutationFn: (data: SettingsFormData) => tenantId ? updateTenantSettings(tenantId, data) : Promise.reject('No tenant'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['available-tenants'] });
    }
  });

  const inAppNotificationPrefsMutation = useMutation({
    mutationFn: (preferences: SignalNotificationPreferences) => {
      if (!tenantId) {
        return Promise.reject(new Error('No tenant'));
      }

      return updateInAppSignalNotificationPreferences(tenantId, preferences);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] }),
        queryClient.invalidateQueries({ queryKey: ['signal-notifications', tenantId] }),
      ]);
    },
  });

  const telegramLinkMutation = useMutation({
    mutationFn: () => {
      if (!tenantId) {
        return Promise.reject(new Error('No tenant'));
      }

      return createTelegramLinkToken(tenantId);
    },
    onSuccess: (result) => {
      setTelegramLinkToken(result);
      setTelegramLinkMessage({
        tone: 'info',
        text: result.deepLinkUrl
          ? 'Ссылка готова. Открой её в личном Telegram-чате с ботом.'
          : 'Токен готов. Укажи TELEGRAM_BOT_USERNAME в env, чтобы Settings показывал готовую t.me ссылку.',
      });
    },
    onError: (error) => {
      setTelegramLinkMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Не удалось создать ссылку привязки.',
      });
    },
  });

  const addCabinetMutation = useMutation({
    mutationFn: (data: { name: string, token: string, allowWarning?: boolean }) => addCabinet(data.name, data.token, data.allowWarning ?? false),
    onSuccess: (res) => {
      if (!res.created) {
        setNewCabinetWarningAvailable(res.requiresWarning);
        setNewCabinetFeedback(buildTokenFeedback(res.preflight, {
          tone: 'warning',
          title: res.title,
          message: res.message,
        }));
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['available-tenants'] });
      queryClient.invalidateQueries({ queryKey: ['tenant', res.tenantId] });
      setTenantId(res.tenantId);
      setUserRole(res.role as UserRole);
      setFeaturePermissions(res.featurePermissions);
      setNeedsTenantSetup(false);
      resetNewCabinetState();
      setActiveTab('current');
    },
    onError: (error) => {
      setNewCabinetWarningAvailable(false);
      setNewCabinetFeedback({
        tone: 'error',
        title: 'Не удалось подключить кабинет',
        message: error instanceof Error ? error.message : 'Ошибка при создании кабинета',
      });
    }
  });

  const switchCabinetMutation = useMutation({
    mutationFn: (id: string) => switchActiveTenant(id),
    onSuccess: (result, id) => {
      setTenantId(id);
      setUserRole(result.role as UserRole);
      setFeaturePermissions(result.featurePermissions);
      setNeedsTenantSetup(false);
      queryClient.invalidateQueries({ queryKey: ['tenant'] });
      setActiveTab('current');
    }
  });

  const validateTokenMutation = useMutation({
    mutationFn: (draftToken?: string) => tenantId ? validateWbToken(tenantId, draftToken) : Promise.reject(new Error('No tenant')),
    onSuccess: (result) => {
      setTokenFeedback(buildTokenFeedback(result));
      setWarningSaveAvailable(false);
      if (result.persistedHealth) {
        setHasStoredToken(true);
        setStoredTokenHealth(result.persistedHealth);
        queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
        queryClient.invalidateQueries({ queryKey: ['available-tenants'] });
      }
    },
    onError: (error) => {
      setWarningSaveAvailable(false);
      setTokenFeedback({
        tone: 'error',
        title: 'Preflight не выполнен',
        message: error instanceof Error ? error.message : 'Не удалось проверить токен',
      });
    }
  });

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setTokenStatus('loading');
    try {
      const result = await saveApiToken(tenantId, token, false);

      if (!result.saved) {
        setTokenStatus('warning');
        setWarningSaveAvailable(result.requiresWarning);
        setTokenFeedback(buildTokenFeedback(result.preflight, {
          tone: 'warning',
          title: result.title,
          message: result.message,
        }));
        return;
      }

      setTokenStatus('saved');
      setWarningSaveAvailable(false);
      setHasStoredToken(true);
      setStoredTokenHealth(result.storedHealth ?? null);
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['available-tenants'] });
      setTokenFeedback({
        tone: 'info',
        title: result.title,
        message: result.message,
        checkedAt: result.storedHealth?.checkedAt,
        source: 'stored',
        checks: result.storedHealth?.checks ?? result.preflight.checks,
      });
      setToken('');
      validateTokenMutation.mutate(undefined);
      setTimeout(() => setTokenStatus('idle'), 3000);
    } catch (error) {
      setTokenStatus('error');
      setWarningSaveAvailable(false);
      setTokenFeedback({
        tone: 'error',
        title: 'Не удалось сохранить токен',
        message: error instanceof Error ? error.message : 'Ошибка при сохранении ключа',
      });
    }
  };

  const handleSaveTokenWithWarning = async () => {
    if (!tenantId || !token.trim()) return;
    setTokenStatus('loading');
    try {
      const result = await saveApiToken(tenantId, token, true);
      setTokenStatus('warning');
      setWarningSaveAvailable(false);
      setHasStoredToken(true);
      setStoredTokenHealth(result.storedHealth ?? null);
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['available-tenants'] });
      setTokenFeedback({
        tone: 'warning',
        title: result.title,
        message: result.message,
        checkedAt: result.storedHealth?.checkedAt,
        source: 'stored',
        checks: result.storedHealth?.checks ?? result.preflight.checks,
      });
      setToken('');
      setTimeout(() => setTokenStatus('idle'), 3000);
    } catch (error) {
      setTokenStatus('error');
      setTokenFeedback({
        tone: 'error',
        title: 'Не удалось сохранить токен',
        message: error instanceof Error ? error.message : 'Ошибка при сохранении ключа',
      });
    }
  };

  const saveTenantSettings = () => {
    settingsMutation.mutate({ 
      shopName, 
      taxType, 
      taxRate, 
      vatMode,
      vatRate,
      wbLkPhone: wbLkPhone.trim() ? wbLkPhone.trim() : savedWbLkPhone,
      telegramChatId: tgChatId ? parseInt(tgChatId) : null, 
      notificationsEnabled,
      telegramSignalNotificationPrefs,
    });
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    saveTenantSettings();
  };

  const handleCopyTelegramLink = async () => {
    const value = telegramLinkToken?.deepLinkUrl ?? telegramLinkToken?.startParameter;
    if (!value) {
      return;
    }

    await navigator.clipboard?.writeText(value);
    setTelegramLinkMessage({
      tone: 'info',
      text: 'Ссылка скопирована.',
    });
  };

  const handleSaveInAppPreferences = () => {
    inAppNotificationPrefsMutation.mutate(inAppSignalNotificationPrefs);
  };

  const togglePreference = (
    setter: React.Dispatch<React.SetStateAction<SignalNotificationPreferences>>,
    key: SignalNotificationPreferenceKey,
  ) => {
    setter((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const storedTokenHealthView = getStoredTokenHealthView(hasStoredToken, storedTokenHealth);
  const wbLkSessionHealthView = getWbLkSessionHealthView(wbLkSessionHealth);
  const selectedTaxRegime = getTaxRegimeDefinition(taxType);
  const selectedVatMode = getVatModeDefinition(vatMode);
  const isTokenActionBusy = tokenStatus === 'loading' || validateTokenMutation.isPending;
  const saveButtonLabel = tokenStatus === 'loading'
    ? 'Применяем...'
    : tokenStatus === 'saved'
      ? 'Ключ применён'
      : 'Применить ключ';

  return (
    <div className="max-w-6xl animate-in fade-in slide-in-from-bottom-2 duration-500 pb-10">
      <div className="mb-8 flex items-center justify-end">
        <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200/50 dark:bg-slate-800 dark:border-slate-700">
          <button
            onClick={() => setActiveTab('current')}
            data-testid="settings-tab-current"
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
              resolvedTab === 'current' ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-200' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
            }`}
          >
            <Settings2 className={`w-4 h-4 ${resolvedTab === 'current' ? 'text-emerald-500' : ''}`} />
            Текущий магазин
          </button>
          <button
            onClick={() => setActiveTab('all')}
            data-testid="settings-tab-all"
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
              resolvedTab === 'all' ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-200' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
            }`}
          >
            <LayoutGrid className={`w-4 h-4 ${resolvedTab === 'all' ? 'text-blue-500' : ''}`} />
            Все магазины
            {validCabinets.length > 0 && <span className="ml-1 px-2 py-0.5 bg-slate-200 rounded-full text-[10px] dark:bg-slate-700">{validCabinets.length}</span>}
          </button>
        </div>
      </div>

      {resolvedTab === 'all' ? (
        <div className="space-y-8">
           {needsTenantSetup && (
             <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50/50 p-6 dark:border-emerald-800/40 dark:bg-emerald-900/20">
               <h3 className="text-lg font-bold text-emerald-900 dark:text-emerald-200">Нужно подключить первый кабинет</h3>
               <p className="mt-2 text-sm font-medium text-emerald-800">
                 Аккаунт создан, но активный кабинет еще не настроен. Добавьте магазин и API-токен Wildberries, чтобы включить аналитику.
               </p>
             </div>
           )}

           <div className="flex items-center justify-between">
              <div>
                 <h3 className="text-xl font-bold text-slate-800 tracking-tight">Ваши проекты</h3>
                 <p className="text-sm text-slate-500 font-medium font-mono text-[10px] uppercase tracking-wide">Управляйте правами и переключайте фокус аналитики</p>
              </div>
              <button 
                onClick={openNewCabinetModal}
                data-testid="open-add-cabinet"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
              >
                <Plus className="w-4 h-4" />
                Добавить кабинет
              </button>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {validCabinets.map((cab) => {
               const healthBadge = getCabinetTokenBadge(cab);

               return (
               <div key={cab.id} className={`group relative p-6 rounded-[2rem] border transition-all duration-300 ${
                 tenantId === cab.id ? 'border-emerald-500 bg-emerald-50/20 shadow-xl shadow-emerald-500/5 dark:border-emerald-800/40 dark:bg-emerald-900/10' : 'bg-white border-slate-100 hover:border-slate-300 shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600'
               }`}>
                 <div className="mb-6 flex justify-between items-start">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg shadow-inner ${
                      tenantId === cab.id ? 'bg-emerald-500 text-white' : 'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                    }`}>
                      {cab.shopName?.[0]?.toUpperCase() || cab.name?.[0]?.toUpperCase() || 'W'}
                    </div>
                    {tenantId === cab.id && (
                       <div className="bg-emerald-500 text-white px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Активен
                       </div>
                    )}
                 </div>
                 <h4 className="font-bold text-slate-800 text-lg mb-1 truncate">{cab.shopName || cab.name}</h4>
                 <div className="mb-6 flex flex-wrap items-center gap-2">
                   <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Доступ: {cab.role}</p>
                   <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${healthBadge.tone}`}>
                     {healthBadge.label}
                   </span>
                 </div>

                 <div className="flex items-center gap-2">
                    <button 
                      onClick={() => switchCabinetMutation.mutate(cab.id)}
                      disabled={tenantId === cab.id || switchCabinetMutation.isPending}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                        tenantId === cab.id ? 'bg-slate-100 text-slate-400 cursor-default' : 'bg-slate-900 text-white hover:bg-black active:scale-95 shadow-lg shadow-slate-900/10'
                      }`}
                    >
                      {tenantId === cab.id ? 'Текущий' : 'Переключить'}
                    </button>
                    <Link 
                       href={`/cabinets/${cab.id}/team`}
                       className="p-2.5 rounded-xl border border-slate-100 text-slate-400 hover:text-emerald-500 hover:border-emerald-200 transition-all"
                       title="Команда"
                    >
                       <Users className="w-4 h-4" />
                    </Link>
                 </div>
               </div>
             )})}
             
             {/* Плейсхолдер для нового */}
             <button
               onClick={openNewCabinetModal}
               className="border-2 border-dashed border-slate-200 rounded-[2rem] p-8 flex flex-col items-center justify-center text-slate-400 hover:text-emerald-500 hover:border-emerald-400 transition-all hover:bg-emerald-50/20 group h-full dark:border-slate-700 dark:text-slate-500 dark:hover:text-emerald-400 dark:hover:border-emerald-800/40 dark:hover:bg-emerald-900/10"
             >
               <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3 group-hover:scale-110 group-hover:bg-emerald-100 transition-all dark:bg-slate-800 dark:group-hover:bg-emerald-900/30">
                 <Plus className="w-6 h-6" />
               </div>
               <span className="font-bold uppercase tracking-widest text-[9px]">Подключить магазин</span>
             </button>
           </div>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/50">
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-400">
                    <Store className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Профиль магазина</h3>
                    <p className="text-xs font-medium text-slate-500">Название, налоговый режим и CSV-импорт.</p>
                  </div>
                </div>
                <CsvUpload />
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(320px,1.4fr)]">
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Название</label>
                  <input
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    placeholder="Напр., ИП Лавров"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium transition-all focus:bg-white focus:outline-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200 dark:focus:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Налоги</label>
                  <button
                    type="button"
                    onClick={() => setTaxExpanded((value) => !value)}
                    className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left transition-all hover:bg-white dark:border-slate-700 dark:bg-slate-900/30 dark:hover:bg-slate-800"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Percent className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                          {selectedTaxRegime.label} · {taxRate}%
                        </p>
                        <p className="truncate text-[11px] font-medium text-slate-500">
                          НДС: {selectedVatMode.id === 'none' ? selectedVatMode.label : `${vatRate}%`}
                        </p>
                      </div>
                    </div>
                    <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${taxExpanded ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>

              {taxExpanded ? (
                <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/20 md:grid-cols-[minmax(220px,1fr)_160px]">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Режим</label>
                    <select
                      value={taxType}
                      onChange={(e) => {
                        const next = normalizeWbTaxType(e.target.value);
                        const regime = getTaxRegimeDefinition(next);
                        setTaxType(next);
                        setTaxRate(regime.defaultRate);
                      }}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 focus:outline-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {WB_TAX_REGIMES.map((type) => (
                        <option key={type.id} value={type.id}>{type.label}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">{selectedTaxRegime.description}</p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Ставка налога, %</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={Number.isNaN(taxRate) ? '' : taxRate}
                      onChange={(e) => setTaxRate(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                      placeholder={String(selectedTaxRegime.defaultRate)}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm font-bold text-slate-800 focus:outline-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                    <p className="mt-1 text-[11px] font-medium text-slate-500">
                      {selectedTaxRegime.rateHint ?? 'В расчёты уходит именно эта ставка из профиля магазина.'}
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">НДС</label>
                    <select
                      value={vatMode}
                      onChange={(e) => {
                        const next = normalizeVatMode(e.target.value);
                        const mode = getVatModeDefinition(next);
                        setVatMode(next);
                        setVatRate(mode.defaultRate);
                      }}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 focus:outline-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {VAT_MODES.map((mode) => (
                        <option key={mode.id} value={mode.id}>{mode.label}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">{selectedVatMode.description}</p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Ставка НДС, %</label>
                    <input
                      type="number"
                      step="0.01"
                      value={Number.isNaN(vatRate) ? '' : vatRate}
                      onChange={(e) => setVatRate(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                      disabled={vatMode === 'none'}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm font-bold text-slate-800 focus:outline-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:disabled:bg-slate-900/40"
                    />
                  </div>
                  <p className="md:col-span-2 text-xs font-medium leading-relaxed text-slate-500">
                    Ставка налога берётся из этого поля и сохраняется в профиле магазина. Для льготной УСН укажите региональный процент вручную: например 1% для «Доходы» или 5% для «Доходы-Расходы». НДС выделяется отдельно из цены WB; если вы плательщик НДС, такую же ставку нужно указать в WB Partners и карточках товаров. ПСН для торговли через маркетплейсы не применяется.
                  </p>
                </div>
              ) : null}

              <div className="flex justify-end">
                <button disabled={settingsMutation.isPending} type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50">
                  {settingsMutation.isPending ? 'Сохранение...' : (settingsMutation.isSuccess ? <><CheckCircle2 className="h-4 w-4" /> Сохранено</> : 'Сохранить профиль')}
                </button>
              </div>
            </form>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section id="wb-token-card" data-testid="wb-token-card" className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/50">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-violet-600 dark:border-violet-800/40 dark:bg-violet-900/20 dark:text-violet-300">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">WB API токен</h3>
                    <p className="truncate text-xs font-medium text-slate-500">{storedTokenHealthView.title}</p>
                  </div>
                </div>
                <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${storedTokenHealthView.badgeTone}`}>
                  {storedTokenHealthView.badgeLabel}
                </span>
              </div>

              <form onSubmit={handleSaveToken} className="space-y-3">
                <div className="flex flex-col gap-2 md:flex-row">
                  <input
                    required
                    type="password"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setTokenFeedback(null);
                      setWarningSaveAvailable(false);
                      setTokenStatus('idle');
                    }}
                    placeholder="Вставьте новый токен WB"
                    className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-sm transition-all focus:bg-white focus:outline-violet-500 focus:ring-4 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
                  />
                  <button disabled={isTokenActionBusy || !token.trim()} type="submit" className="h-11 rounded-xl bg-violet-600 px-5 text-sm font-bold text-white transition-all hover:bg-violet-700 active:scale-[0.98] disabled:opacity-50">
                    {saveButtonLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => validateTokenMutation.mutate(token.trim() || undefined)}
                    disabled={isTokenActionBusy || !tenantId}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
                  >
                    {validateTokenMutation.isPending ? 'Проверка...' : 'Проверить'}
                  </button>
                </div>

                {warningSaveAvailable ? (
                  <button
                    type="button"
                    onClick={handleSaveTokenWithWarning}
                    disabled={isTokenActionBusy || !token.trim()}
                    className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-800 transition-all hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200"
                  >
                    Сохранить с предупреждением
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => setTokenExpanded((value) => !value)}
                  className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800 dark:hover:text-slate-200"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${tokenExpanded ? 'rotate-180' : ''}`} />
                  Детали проверки
                </button>

                {(tokenExpanded || validateTokenMutation.isPending || tokenFeedback) ? (
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-700 dark:bg-slate-900/20">
                    <p className="font-medium leading-relaxed text-slate-500">
                      Ключ применяется сразу. Проверка WB идёт после сохранения и временно блокирует синхронизацию, пока статус не станет понятным.
                    </p>
                    {validateTokenMutation.isPending ? (
                      <div className="grid gap-2 md:grid-cols-4">
                        {['Статистика', 'Контент', 'Цены', 'Реклама'].map((label) => (
                          <div key={label} className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-200">
                            <span className="font-bold">{label}</span>
                            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {tokenFeedback ? (
                      <div
                        data-testid="token-preflight-status"
                        className={`rounded-2xl border px-4 py-3 ${
                          tokenFeedback.tone === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200'
                            : tokenFeedback.tone === 'warning'
                              ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200'
                            : tokenFeedback.tone === 'error'
                              ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200'
                              : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-200'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {tokenFeedback.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
                          <div>
                            <p className="font-bold">{tokenFeedback.title}</p>
                            <p className="mt-1 font-medium leading-relaxed">{tokenFeedback.message}</p>
                            {tokenFeedback.checkedAt ? (
                              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider opacity-70">
                                Проверено {formatCheckedAt(tokenFeedback.checkedAt)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        {tokenFeedback.checks?.length ? (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {tokenFeedback.checks.map((check) => (
                              <div key={check.key} className={`rounded-xl border px-3 py-2 ${check.ok ? 'border-emerald-200 bg-white/70 text-emerald-800 dark:border-emerald-800/40 dark:bg-slate-800/40 dark:text-emerald-200' : 'border-rose-200 bg-white/70 text-rose-800 dark:border-rose-800/40 dark:bg-slate-800/40 dark:text-rose-200'}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-bold">{getTokenCheckLabel(check)}</span>
                                  <span className="text-[10px] font-bold uppercase tracking-wider">{check.ok ? 'OK' : 'Нет доступа'}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </form>
            </section>

            <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/50">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-400">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">WB ЛК</h3>
                    <p className="truncate text-xs font-medium text-slate-500">{wbLkSessionHealthView.title}</p>
                  </div>
                </div>
                <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${wbLkSessionHealthView.badgeTone}`}>
                  {wbLkSessionHealthView.badgeLabel}
                </span>
              </div>

              <div className="mb-3 inline-flex items-center gap-2 text-xs font-bold text-slate-500">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Вход по SMS и CAPTCHA
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/20">
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <input
                    autoComplete="off"
                    value={wbLkPhone}
                    onChange={(e) => setWbLkPhone(e.target.value)}
                    placeholder={savedWbLkPhone ?? '+7**********'}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm font-bold text-slate-800 focus:outline-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={saveTenantSettings}
                    disabled={settingsMutation.isPending}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
                  >
                    Сохранить номер
                  </button>
                </div>
                <WbLkAuthFlow
                  initialPhone={wbLkPhone.trim() || savedWbLkPhone}
                  onSuccess={() => {
                    void refreshTenantSettings();
                    void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
                    void queryClient.invalidateQueries({ queryKey: ['available-tenants'] });
                  }}
                />
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/50">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300">
                  <Bell className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Уведомления</h3>
                  <p className="text-xs font-medium text-slate-500">
                    Telegram {notificationsEnabled ? 'включён' : 'выключен'} · Центр уведомлений настраивается отдельно
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNotificationsExpanded((value) => !value)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
              >
                Настроить
                <ChevronDown className={`h-4 w-4 transition-transform ${notificationsExpanded ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {notificationsExpanded ? (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/20">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-blue-600" />
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Telegram</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notificationsEnabled}
                      onChange={(e) => setNotificationsEnabled(e.target.checked)}
                      className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </div>
                  <input
                    value={tgChatId}
                    onChange={(e) => setTgChatId(e.target.value)}
                    placeholder="Активный Chat ID"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                  <p className="mt-2 text-xs font-medium leading-relaxed text-slate-500">
                    {telegramActiveLink
                      ? `Активная связь: ${telegramActiveLink.chatType}, ${telegramActiveLink.telegramUsername ? `@${telegramActiveLink.telegramUsername}` : `user ${telegramActiveLink.telegramUserId ?? 'н/д'}`}.`
                      : 'Новая безопасная привязка создаётся через одноразовую ссылку. Поле Chat ID оставлено как legacy fallback.'}
                  </p>
                  <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-800/40 dark:bg-blue-900/20">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-bold text-blue-900 dark:text-blue-100">Безопасная привязка</p>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-blue-700 dark:text-blue-200">
                          Ссылка действует 15 минут и привязывает только личный чат Telegram.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => telegramLinkMutation.mutate()}
                        disabled={telegramLinkMutation.isPending}
                        className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        {telegramLinkMutation.isPending ? 'Создание...' : 'Создать ссылку'}
                      </button>
                    </div>
                    {telegramLinkToken ? (
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            readOnly
                            value={telegramLinkToken.deepLinkUrl ?? telegramLinkToken.startParameter}
                            className="h-10 min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-3 font-mono text-xs text-blue-950 dark:border-blue-800/60 dark:bg-slate-900 dark:text-blue-100"
                          />
                          <button
                            type="button"
                            onClick={handleCopyTelegramLink}
                            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-50 dark:border-blue-800/60 dark:bg-slate-900 dark:text-blue-200"
                          >
                            Скопировать
                          </button>
                          {telegramLinkToken.deepLinkUrl ? (
                            <a
                              href={telegramLinkToken.deepLinkUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg bg-blue-700 px-3 py-2 text-center text-xs font-bold text-white transition-colors hover:bg-blue-800"
                            >
                              Открыть
                            </a>
                          ) : null}
                        </div>
                        <p className="text-[11px] font-medium text-blue-700 dark:text-blue-200">
                          Истекает: {new Date(telegramLinkToken.expiresAt).toLocaleString('ru-RU')}.
                        </p>
                      </div>
                    ) : null}
                    {telegramLinkMessage ? (
                      <p className={`mt-2 text-xs font-bold ${telegramLinkMessage.tone === 'error' ? 'text-rose-700 dark:text-rose-300' : 'text-blue-700 dark:text-blue-200'}`}>
                        {telegramLinkMessage.text}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2">
                    {SIGNAL_NOTIFICATION_FIELDS.map((field) => (
                      <label key={`telegram-${field.key}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                        <span>
                          <span className="block text-sm font-bold text-slate-700 dark:text-slate-200">{field.label}</span>
                          <span className="block text-[11px] font-medium text-slate-500">{field.description}</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={telegramSignalNotificationPrefs[field.key]}
                          onChange={() => togglePreference(setTelegramSignalNotificationPrefs, field.key)}
                          data-testid={`telegram-signal-pref-${field.key}`}
                          className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={saveTenantSettings}
                    disabled={settingsMutation.isPending}
                    className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {settingsMutation.isPending ? 'Сохранение...' : 'Сохранить Telegram'}
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/20">
                  <p className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Внутри приложения</p>
                  <div className="grid gap-2">
                    {SIGNAL_NOTIFICATION_FIELDS.map((field) => (
                      <label key={`inapp-${field.key}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                        <span>
                          <span className="block text-sm font-bold text-slate-700 dark:text-slate-200">{field.label}</span>
                          <span className="block text-[11px] font-medium text-slate-500">{field.description}</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={inAppSignalNotificationPrefs[field.key]}
                          onChange={() => togglePreference(setInAppSignalNotificationPrefs, field.key)}
                          data-testid={`inapp-signal-pref-${field.key}`}
                          className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveInAppPreferences}
                    disabled={inAppNotificationPrefsMutation.isPending}
                    className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
                  >
                    {inAppNotificationPrefsMutation.isPending
                      ? 'Сохранение...'
                      : inAppNotificationPrefsMutation.isSuccess
                        ? 'Сохранено'
                        : 'Сохранить в приложении'}
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/50">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300">
                <RefreshCw className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Синхронизация</h3>
                <p className="text-xs font-medium text-slate-500">Последний статус сверху, подробная история раскрывается по запросу.</p>
              </div>
            </div>
            <SyncButton hasStoredToken={hasStoredToken} tokenHealth={storedTokenHealth} />
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            {tenantId ? (
              <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/50">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Команда и доступы</h3>
                    <p className="text-xs font-medium text-slate-500">Роли и видимые разделы менеджеров.</p>
                  </div>
                </div>
                <Link
                  href={`/cabinets/${tenantId}/team`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-slate-800 active:scale-[0.98] dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  <Users className="h-4 w-4" />
                  Управлять командой
                </Link>
              </section>
            ) : null}

            <PasswordSettingsCard />
          </div>
        </div>
      )}

      {/* MODAL: Добавление кабинета */}
      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 dark:bg-slate-800">
            <div className="p-8 pb-0 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
                  <Store className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">Новый Кабинет</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest dark:text-slate-500">Интеграция с Wildberries</p>
                </div>
              </div>
              <button onClick={resetNewCabinetState} aria-label="Отменить" className="p-2 text-slate-300 hover:text-slate-600 transition-colors dark:text-slate-600 dark:hover:text-slate-400">
                 <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Название Магазина</label>
                <input
                  data-testid="new-cabinet-name"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setNewCabinetFeedback(null);
                    setNewCabinetWarningAvailable(false);
                  }}
                  placeholder="Напр. ООО Ритейл Групп"
                  className="w-full px-5 py-4 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:outline-emerald-500 transition-all font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200 dark:focus:bg-slate-800 dark:placeholder:text-slate-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">API Токен (Контент/Аналитика)</label>
                <div className="relative">
                  <KeyRound className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                  <input
                    data-testid="new-cabinet-token"
                    type="password"
                    value={newToken}
                    onChange={(e) => {
                      setNewToken(e.target.value);
                      setNewCabinetFeedback(null);
                      setNewCabinetWarningAvailable(false);
                    }}
                    placeholder="wb_api_token..."
                    className="w-full pl-14 pr-5 py-4 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:outline-emerald-500 transition-all font-mono text-sm dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200 dark:focus:bg-slate-800 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-4 dark:bg-amber-900/20 dark:border-amber-800/40">
                <ShieldCheck className="w-10 h-10 text-amber-500 flex-shrink-0 dark:text-amber-400" />
                <p className="text-[11px] font-medium text-amber-900 leading-relaxed">
                  Ваш токен будет зашифрован ключом AES-256 перед сохранением. Мы используем его только для получения статистики и отчетов через официальное API Wildberries.
                </p>
              </div>

              {newCabinetFeedback ? (
                <div
                  data-testid="new-cabinet-feedback"
                  className={`rounded-2xl border px-4 py-3 text-xs ${
                    newCabinetFeedback.tone === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200'
                      : newCabinetFeedback.tone === 'warning'
                        ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200'
                        : newCabinetFeedback.tone === 'error'
                          ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-200'
                          : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {newCabinetFeedback.tone === 'success' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    )}
                    <div className="space-y-1">
                      <p className="font-bold">{newCabinetFeedback.title}</p>
                      <p className="font-medium leading-relaxed">{newCabinetFeedback.message}</p>
                      {newCabinetFeedback.checkedAt ? (
                        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                          Проверено {formatCheckedAt(newCabinetFeedback.checkedAt)}
                          {newCabinetFeedback.source === 'draft' ? ' • по введённому токену' : ' • по сохранённому токену'}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {newCabinetFeedback.checks?.length ? (
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {newCabinetFeedback.checks.map((check) => (
                        <div
                          key={`new-cabinet-${check.key}`}
                          className={`rounded-xl border px-3 py-2 ${
                            check.ok
                              ? 'border-emerald-200 bg-white/70 text-emerald-800 dark:border-emerald-800/40 dark:bg-slate-700/40 dark:text-emerald-200'
                              : newCabinetFeedback.tone === 'warning'
                                ? 'border-amber-200 bg-white/70 text-amber-800 dark:border-amber-800/40 dark:bg-slate-700/40 dark:text-amber-200'
                                : 'border-rose-200 bg-white/70 text-rose-800 dark:border-rose-800/40 dark:bg-slate-700/40 dark:text-rose-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold">{check.label}</span>
                            <span className="text-[10px] font-semibold uppercase tracking-wider">
                              {check.ok ? 'OK' : 'Fail'}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] font-medium leading-relaxed">{check.message}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button 
                onClick={() => addCabinetMutation.mutate({ name: newName, token: newToken })}
                data-testid="activate-cabinet"
                disabled={!newName || !newToken || addCabinetMutation.isPending}
                className="w-full py-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-[1.5rem] font-bold shadow-xl shadow-emerald-600/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
              >
                {addCabinetMutation.isPending ? 'Подключаем...' : 'Подключить кабинет'}
              </button>

              {newCabinetWarningAvailable ? (
                <button
                  type="button"
                  onClick={() => addCabinetMutation.mutate({ name: newName, token: newToken, allowWarning: true })}
                  data-testid="activate-cabinet-with-warning"
                  disabled={!newName || !newToken || addCabinetMutation.isPending}
                  className="w-full py-4 rounded-[1.5rem] border border-amber-300 bg-amber-50 font-bold text-amber-800 transition-all hover:border-amber-400 hover:bg-amber-100 active:scale-[0.98] disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
                >
                  Подключить кабинет с предупреждением
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
