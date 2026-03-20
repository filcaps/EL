import { useState } from 'react'

interface CoinIconProps {
  symbol: string
  size?: number
}

// Normalise symbol: strip "/" and convert to lowercase for CDN lookup
function iconUrl(symbol: string): string {
  const sym = symbol.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/128/color/${sym}.png`
}

// Pick a deterministic bg tint from the symbol
const COLORS = [
  '#1a3c3d', '#2d4a22', '#3a2d1a', '#2a1a3c', '#3c1a2d',
  '#1a2d3c', '#3c3a1a', '#1a3c2a',
]
function avatarColor(symbol: string): string {
  let h = 0
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

export function CoinIcon({ symbol, size = 20 }: CoinIconProps) {
  const [error, setError] = useState(false)

  if (!error) {
    return (
      <img
        src={iconUrl(symbol)}
        alt={symbol}
        width={size}
        height={size}
        className="rounded-full shrink-0 object-cover"
        style={{ width: size, height: size }}
        onError={() => setError(true)}
      />
    )
  }

  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-bold text-white/70"
      style={{
        width: size,
        height: size,
        fontSize: Math.floor(size * 0.42),
        background: avatarColor(symbol),
      }}
    >
      {(symbol[0] ?? '?').toUpperCase()}
    </div>
  )
}
