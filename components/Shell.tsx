"use client";

// The page frame: name and one link along the top, a centred column for the
// content, and a quiet line at the bottom.
export function Shell({
  children,
  actions,
  banner,
  footer,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  banner?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col px-6 py-6 sm:px-12 sm:py-10">
      <header className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium">alih bahasa</span>
        {actions}
      </header>
      {banner}
      <main className="flex flex-1 flex-col items-center justify-center py-14 text-center">
        {children}
      </main>
      <footer className="min-h-4 text-center text-xs tracking-[0.2em] text-mute">{footer}</footer>
    </div>
  );
}
