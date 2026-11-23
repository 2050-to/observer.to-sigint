import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import { App } from './App'
import { LegalGate } from './LegalGate'
import { Verify } from './Verify'
import './styles.css'

function Root() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const normalized = path.replace(/\/$/, '') || '/'
  if (normalized === '/auth/verify') return <Verify />
  return (
    <LegalGate>
      <App />
    </LegalGate>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
