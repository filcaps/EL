import { useState } from 'react'

interface CoinIconProps {
  symbol: string
  size?: number
}

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

const CDN = 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/128/color'

function buildUrls(key: string): string[] {
  const urls: string[] = [`/coins/${key}.png`]
  // For U-prefixed bridged tokens (ubtc, ueth, usol…), try the base asset icon locally
  if (key.startsWith('u') && key.length > 2) {
    urls.push(`/coins/${key.slice(1)}.png`)
  }
  urls.push(`${CDN}/${key}.png`)
  return urls
}

export function CoinIcon({ symbol, size = 20 }: CoinIconProps) {
  const key = toKey(symbol)
  const urls = buildUrls(key)

  const [idx, setIdx] = useState(0)
  const [failed, setFailed] = useState(false)

  function handleError() {
    if (idx + 1 < urls.length) {
      setIdx(idx + 1)
    } else {
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
      src={urls[idx]}
      alt={symbol}
      width={size}
      height={size}
      className="rounded-full shrink-0 object-cover"
      style={{ width: size, height: size }}
      onError={handleError}
    />
  )
}
