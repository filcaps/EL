import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId="cmmwk50h500ij0cjjg19y4bao"
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#3b82f6',
        },
        loginMethods: ['wallet', 'email'],
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
)
