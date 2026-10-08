"use client";

// The page frame: blueprint grid background, caption, header bar and footer.
export function Shell({
  children,
  nav,
  actions,
}: {
  children: React.ReactNode;
  nav?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="blueprint min-h-screen px-3 py-8 sm:px-6 md:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 px-1 sm:mb-8">
          <p className="caption">Alih bahasa / Document translation</p>
          <p className="caption text-ink-faint">Private studio · Powered by DeepL</p>
        </div>
        <div className="frame">
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-5 md:px-6">
            <span className="brand shrink-0">Alih Bahasa</span>
            {nav}
            {actions ?? <span className="micro">EN / FR / ID</span>}
          </header>
          {children}
          <footer className="flex items-center justify-between border-t-2 border-ink px-5 py-4 md:px-6">
            <span className="micro">© Alih Bahasa {new Date().getFullYear()}</span>
            <a
              href="#"
              className="micro link"
              onClick={(e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Back to top ↑
            </a>
          </footer>
        </div>
      </div>
    </div>
  );
}
