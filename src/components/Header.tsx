const QUOTE_OF_THE_DAY = '"The only journey is the one within." — RAINER MARIA RILKE'

interface HeaderProps {
  onReset?: () => void
  walletAddress?: string
}

export function Header({ onReset, walletAddress }: HeaderProps) {
  return (
    <header className="border-b border-border bg-surface-0 sticky top-0 z-50">
      <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between gap-4">

        {/* Left: logo + nav */}
        <div className="flex items-center gap-6 shrink-0">
          <button
            onClick={onReset}
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
          >
            {/* Blue circle Q logo */}
            <div className="w-7 h-7 bg-accent-blue rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold leading-none">Q</span>
            </div>
            <span className="text-sm font-semibold text-text-primary tracking-tight">Quote</span>
          </button>

          <nav className="flex items-center gap-5">
            <span className="text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
              Trade
            </span>
            <span className="text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
              Portfolio
            </span>
          </nav>
        </div>

        {/* Center: italic quote */}
        <div className="hidden lg:block flex-1 text-center">
          <span className="text-xs italic text-text-muted tracking-wide">{QUOTE_OF_THE_DAY}</span>
        </div>

        {/* Right: wallet pill or Connect Wallet */}
        <div className="shrink-0">
          {walletAddress ? (
            <button
              onClick={onReset}
              className="px-4 py-1.5 bg-surface-3 border border-border rounded-lg hover:border-border-bright transition-colors"
            >
              <span className="font-mono text-xs text-text-secondary">
                {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
              </span>
            </button>
          ) : (
            <button className="px-4 py-1.5 border border-border rounded-lg text-xs text-text-secondary hover:border-border-bright hover:text-text-primary transition-colors">
              Connect Wallet
            </button>
          )}
        </div>

      </div>
    </header>
  )
}
