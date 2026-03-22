import { useState, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import CallCenter from './pages/CallCenter'
import VoiceCreate from './pages/VoiceCreate'
import ModelManager from './pages/ModelManager'
import TrainingData from './pages/TrainingData'
import Chat from './pages/Chat'
import VoiceChat from './pages/VoiceChat'
import History from './pages/History'
import Settings from './pages/Settings'
import HealthCheck from './pages/HealthCheck'
import SystemSetup from './pages/SystemSetup'

function App() {
  const [setupDone, setSetupDone] = useState(false)

  const handleSetupComplete = useCallback(() => {
    setSetupDone(true)
  }, [])

  // Show system setup screen first
  if (!setupDone) {
    return <SystemSetup onComplete={handleSetupComplete} />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/calls" element={<CallCenter />} />
        <Route path="/voice-create" element={<VoiceCreate />} />
        <Route path="/models" element={<ModelManager />} />
        <Route path="/training-data" element={<TrainingData />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/voice-chat" element={<VoiceChat />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/health-check" element={<HealthCheck />} />
      </Routes>
    </Layout>
  )
}

export default App
