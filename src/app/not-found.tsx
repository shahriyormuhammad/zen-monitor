import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 text-center p-6">
      <div className="flex flex-col items-center gap-3">
        <p className="text-7xl font-bold text-muted-foreground/30">404</p>
        <h2 className="text-xl font-semibold text-foreground">Страница не найдена</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Страница, которую вы ищете, не существует или была перемещена.
        </p>
      </div>
      <Link
        href="/overview"
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Вернуться на главную
      </Link>
    </div>
  );
}
