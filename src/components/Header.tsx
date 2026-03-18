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
            {/* Quote logo — two stylised open quotation marks */}
            <svg width="26" height="18" viewBox="0 0 26 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Left mark: filled circle + curved descending tail */}
              <circle cx="4.5" cy="4.5" r="4" fill="#9ca3af" />
              <path d="M1 8 Q0.5 12 2.5 16" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" />
              {/* Right mark */}
              <circle cx="17.5" cy="4.5" r="4" fill="#6b7280" />
              <path d="M14 8 Q13.5 12 15.5 16" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
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
