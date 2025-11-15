import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { SocketProvider } from './context/SocketContext.jsx'
import { SessionProvider } from './context/SessionContext.jsx'
import { TelemetryProvider } from './context/TelemetryContext.jsx'
import SpectatorApp from './spectate/SpectatorApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SocketProvider>
      <SessionProvider>
        <TelemetryProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<App />} />
              <Route path="/spectate" element={<SpectatorApp />} />
            </Routes>
          </BrowserRouter>
        </TelemetryProvider>
      </SessionProvider>
    </SocketProvider>
  </StrictMode>,
)
