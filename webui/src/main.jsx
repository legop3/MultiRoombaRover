// WebUI Bootstrap Entry
// Purpose: Boots the React application and mounts global providers/router roots. Scope: Defines top-level route wiring and root render lifecycle for the browser app.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { SocketProvider } from './context/SocketContext.jsx'
import { SessionProvider } from './context/SessionContext.jsx'
import { TelemetryProvider } from './context/TelemetryContext.jsx'
import { ChatProvider } from './context/ChatContext.jsx'
import SpectatorApp from './spectate/SpectatorApp/SpectatorAppRoot.jsx'
import MiniSummaryApp from './mini/MiniSummaryApp/MiniSummaryAppRoot.jsx'
import ServerDisplayApp from './display/ServerDisplayApp/ServerDisplayAppRoot.jsx'
import ScannerApp from './scanner/ScannerApp/ScannerAppRoot.jsx'
import DatabaseAdminApp from './database/DatabaseAdminApp.jsx'
import { SettingsProvider } from './settings/index.js'
import DeterrenceChaos from './components/DeterrenceChaos/index.jsx'
import AnalyticsReporter from './analytics/AnalyticsReporter.jsx'
import SessionDocumentTitle from './components/SessionDocumentTitle/index.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SocketProvider>
      <SessionProvider>
        <SessionDocumentTitle />
        <TelemetryProvider>
          <SettingsProvider>
            <ChatProvider>
              <DeterrenceChaos />
              <BrowserRouter>
                <AnalyticsReporter />
                <Routes>
                  <Route path="/" element={<App />} />
                  <Route path="/spectate" element={<SpectatorApp />} />
                  <Route path="/mini" element={<MiniSummaryApp />} />
                  <Route path="/display" element={<ServerDisplayApp />} />
                  <Route path="/scanner" element={<ScannerApp />} />
                  <Route path="/database" element={<DatabaseAdminApp />} />
                </Routes>
              </BrowserRouter>
            </ChatProvider>
          </SettingsProvider>
        </TelemetryProvider>
      </SessionProvider>
    </SocketProvider>
  </StrictMode>,
)
