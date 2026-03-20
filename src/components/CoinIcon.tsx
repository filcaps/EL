import { useState } from 'react'

interface CoinIconProps {
  symbol: string
  size?: number
}

// Normalise symbol to lowercase filename key (strips "/" etc.)
function toKey(symbol: string): string {
  return symbol.split('/')[0].toLowerCase()
}

// Pick a deterministic bg tint from the symbol for the fallback avatar
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
  // Three-stage fallback: local asset → CDN → coloured avatar
  const key = toKey(symbol)
  const localUrl = `/coins/${key}.png`
  const cdnUrl = `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/128/color/${key}.png`

  const [src, setSrc] = useState(localUrl)
  const [failed, setFailed] = useState(false)

  function handleError() {
    if (src === localUrl) {
      // Try CDN next
      setSrc(cdnUrl)
    } else {
      // Both failed — show avatar
      setFailed(true)
    }
  }

  if (failed) {
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

  return (
    <img
      src={src}
      alt={symbol}
      width={size}
      height={size}
      className="rounded-full shrink-0 object-cover"
      style={{ width: size, height: size }}
      onError={handleError}
    />
  )
}
