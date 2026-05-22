'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { acceptInvitation } from '@/app/(dashboard)/cabinets/user-actions';
import { useRouter } from 'next/navigation';
import { ShieldCheck, UserPlus, ArrowRight, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: () => {
      // Перенаправляем на дашборд
      router.push('/overview');
      window.location.reload(); // Перезапуск для обновления контекста Zustand
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Ошибка при принятии приглашения');
    }
  });

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 dark:bg-slate-900">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-[3rem] shadow-2xl shadow-slate-200/50 border border-slate-100 dark:border-slate-700 dark:shadow-slate-900/50 overflow-hidden animate-in zoom-in-95 duration-500">
        <div className="p-10 text-center">
          <div className="w-20 h-20 bg-emerald-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-emerald-600 shadow-inner">
             <UserPlus className="w-10 h-10" />
          </div>

          <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-2">Вы приглашены!</h1>
          <p className="text-slate-500 text-sm font-medium leading-relaxed mb-8">Ваш коллега приглашает вас присоединиться к управлению магазином на платформе аналитики.</p>

          {error ? (
            <div className="bg-red-50 border border-red-100 p-6 rounded-2xl mb-8 animate-in shake duration-300 dark:bg-red-900/20 dark:border-red-800/40">
               <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
               <p className="text-red-700 text-xs font-bold uppercase tracking-wider">Ошибка</p>
               <p className="text-red-600 text-sm font-medium mt-1">{error}</p>
               <Link href="/login" className="inline-block mt-4 text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest border-b border-slate-200">Вернуться ко входу</Link>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-100 p-6 rounded-2xl text-left dark:bg-slate-800/50 dark:border-slate-700">
                 <div className="flex items-center gap-3 mb-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-500" />
                    <span className="text-sm font-bold text-slate-700">После принятия:</span>
                 </div>
                 <ul className="space-y-2">
                    <li className="flex items-start gap-2 text-xs font-medium text-slate-500 italic">
                       <span className="text-emerald-500">•</span> Вы получите доступ к аналитике магазина
                    </li>
                    <li className="flex items-start gap-2 text-xs font-medium text-slate-500 italic">
                       <span className="text-emerald-500">•</span> Ваши действия будут видны владельцу
                    </li>
                 </ul>
              </div>

              <button
                onClick={() => acceptMutation.mutate()}
                disabled={acceptMutation.isPending}
                className="w-full py-5 bg-slate-900 hover:bg-slate-800 text-white rounded-[1.5rem] font-bold shadow-xl shadow-slate-900/20 transition-all flex items-center justify-center gap-3 group active:scale-95 disabled:opacity-50"
              >
                {acceptMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Принять приглашение
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                 Нажимая кнопку, вы соглашаетесь с правилами платформы
              </p>
            </div>
          )}
        </div>

        <div className="bg-slate-50 p-6 text-center border-t border-slate-100 dark:bg-slate-800/50 dark:border-slate-700">
           <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
              Enterprise Analytics Platform<br/>
              <span className="text-[10px] opacity-50 font-medium">Safe & Secure RBAC System</span>
           </p>
        </div>
      </div>
    </div>
  );
}
