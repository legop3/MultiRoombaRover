import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { SocketProvider } from './context/SocketContext.jsx'
import { SessionProvider } from './context/SessionContext.jsx'
import { TelemetryProvider } from './context/TelemetryContext.jsx'
import { ChatProvider } from './context/ChatContext.jsx'
import SpectatorApp from './spectate/SpectatorApp.jsx'
import MiniSummaryApp from './mini/MiniSummaryApp.jsx'
import { SettingsProvider } from './settings/index.js'
import DeterrenceChaos from './components/DeterrenceChaos/index.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SocketProvider>
      <SessionProvider>
        <TelemetryProvider>
          <SettingsProvider>
            <ChatProvider>
              <DeterrenceChaos />
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<App />} />
                  <Route path="/spectate" element={<SpectatorApp />} />
                  <Route path="/mini" element={<MiniSummaryApp />} />
                </Routes>
              </BrowserRouter>
            </ChatProvider>
          </SettingsProvider>
        </TelemetryProvider>
      </SessionProvider>
    </SocketProvider>
  </StrictMode>,
)
