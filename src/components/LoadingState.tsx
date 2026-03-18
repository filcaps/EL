interface LoadingStateProps {
  stage: string
  detail?: string
}

export function LoadingState({ stage, detail }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-6">
      {/* Animated bars */}
      <div className="flex items-end gap-1 h-10">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="w-1.5 bg-accent-blue rounded-sm"
            style={{
              animation: `barPulse 1s ease-in-out ${i * 0.15}s infinite`,
              height: '100%',
            }}
          />
        ))}
      </div>

      <div className="text-center">
        <p className="text-sm font-medium text-text-primary">{stage}</p>
        {detail && <p className="text-xs text-text-muted mt-1 font-mono">{detail}</p>}
      </div>

      <style>{`
        @keyframes barPulse {
          0%, 100% { transform: scaleY(0.2); opacity: 0.3; }
          50% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="max-w-2xl mx-auto mt-12 px-6">
      <div className="card border-neg/30 bg-neg-dim/20 p-5">
        <p className="text-sm font-medium text-neg mb-1">Analysis Failed</p>
        <p className="text-xs text-text-secondary font-mono">{message}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-3 btn-ghost text-xs">
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
