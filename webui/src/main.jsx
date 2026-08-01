// WebUI Bootstrap Entry
// Purpose: Boots the React application and mounts global providers/router roots. Scope: Defines top-level route wiring and root render lifecycle for the browser app.
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
// Theme artwork is a separate style concern from global component utilities. Loading its dedicated
// entrypoint here keeps every route consistent without returning theme definitions to index.css.
import './themes/styles/index.css'
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
import PtzAppRoot from './ptz/PtzAppRoot.jsx'

// The reporting route includes the charting and CSV libraries. Loading that
// bundle only when `/reports` is visited keeps ordinary rover-control sessions
// from paying the cost of the in-depth diagnostics interface.
const FleetReportsApp = lazy(() => import('./reports/FleetReportsApp.jsx'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SocketProvider>
      <SessionProvider>
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
                  {/*
                    PTZ is a separate route so the driver layout and its replay
                    panel are not mounted behind the camera controller. This
                    also makes orientation changes a PTZ layout concern instead
                    of a local overlay-open state owned by the driver page.
                  */}
                  <Route path="/ptz" element={<PtzAppRoot />} />
                  <Route
                    path="/reports"
                    element={(
                      <Suspense fallback={<div className="min-h-screen bg-neutral-950 p-1 text-sm text-slate-300">Loading fleet reports…</div>}>
                        <FleetReportsApp />
                      </Suspense>
                    )}
                  />
                </Routes>
              </BrowserRouter>
            </ChatProvider>
          </SettingsProvider>
        </TelemetryProvider>
      </SessionProvider>
    </SocketProvider>
  </StrictMode>,
)
