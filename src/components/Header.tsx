import { Activity } from 'lucide-react'

interface HeaderProps {
  onReset?: () => void
  walletAddress?: string
}

export function Header({ onReset, walletAddress }: HeaderProps) {
  return (
    <header className="border-b border-border bg-surface-1 sticky top-0 z-50">
      <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={onReset}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <div className="w-7 h-7 bg-accent-blue rounded flex items-center justify-center">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold tracking-tight text-text-primary">ExecLoss</span>
            <span className="text-xs text-text-muted font-mono">v0.1</span>
          </div>
        </button>

        {/* Center label */}
        <div className="hidden md:flex items-center gap-2 text-xs text-text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-pos animate-pulse" />
          Hyperliquid Execution Analytics
        </div>

        {/* Right: wallet pill */}
        {walletAddress && (
          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 bg-surface-3 border border-border rounded-lg">
              <span className="font-mono text-xs text-text-secondary">
                {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
              </span>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
