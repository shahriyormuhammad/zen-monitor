export const STALE_SYNC_RUN_REASON_CODE = "sync_run_stale_timeout";
export const DEFAULT_SYNC_STALE_TIMEOUT_MINUTES = 60;

export function formatStaleSyncRunMessage(timeoutMinutes: number) {
  return `[${STALE_SYNC_RUN_REASON_CODE}] Запуск был автоматически остановлен после ${timeoutMinutes} мин без финализации.`;
}

export function isStaleSyncRunError(message: string | null | undefined) {
  if (!message) {
    return false;
  }

  return message.includes(`[${STALE_SYNC_RUN_REASON_CODE}]`);
}
