import { usePrivy, useWallets } from '@privy-io/react-auth'
import { LogOut } from 'lucide-react'

interface HeaderProps {
  onReset?: () => void
  onShowData?: () => void
  activeView?: string
  walletAddress?: string
}

export function Header({ onReset, onShowData, activeView, walletAddress }: HeaderProps) {
  const { ready, authenticated, login, logout } = usePrivy()
  const { wallets } = useWallets()
  const connectedAddress = wallets[0]?.address

  // The address to display in the pill (prefer the analysed one, fall back to connected)
  const displayAddress = walletAddress ?? connectedAddress

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
              <circle cx="4.5" cy="4.5" r="4" fill="#235051" />
              <path d="M1 8 Q0.5 12 2.5 16" stroke="#235051" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="17.5" cy="4.5" r="4" fill="#235051" fillOpacity="0.6" />
              <path d="M14 8 Q13.5 12 15.5 16" stroke="#235051" strokeOpacity="0.6" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-semibold text-text-primary tracking-tight">Quote</span>
          </button>

          <nav className="flex items-center gap-5">
            <button
              onClick={onShowData}
              className={`text-sm transition-colors ${
                activeView === 'data'
                  ? 'text-text-primary border-b-2 border-accent-blue pb-0.5'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Data
            </button>
          </nav>
        </div>

        {/* Right: wallet controls */}
        <div className="shrink-0 flex items-center gap-2">
          {!ready ? null : authenticated && displayAddress ? (
            <>
              <button
                onClick={onReset}
                className="px-4 py-1.5 bg-surface-3 border border-border rounded-lg hover:border-border-bright transition-colors"
              >
                <span className="font-mono text-xs text-text-secondary">
                  {displayAddress.slice(0, 6)}…{displayAddress.slice(-4)}
                </span>
              </button>
              <button
                onClick={() => { logout(); onReset?.() }}
                className="p-1.5 btn-ghost text-text-muted hover:text-text-secondary"
                title="Disconnect wallet"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={login}
              className="px-4 py-1.5 border border-border rounded-lg text-xs text-text-secondary hover:border-border-bright hover:text-text-primary transition-colors"
            >
              Connect Wallet
            </button>
          )}
        </div>

      </div>
    </header>
  )
}
