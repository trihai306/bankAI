import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import CallCenter from './pages/CallCenter'
import VoiceTraining from './pages/VoiceTraining'
import ModelManager from './pages/ModelManager'
import TrainingData from './pages/TrainingData'
import Chat from './pages/Chat'
import History from './pages/History'
import Settings from './pages/Settings'
import HealthCheck from './pages/HealthCheck'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/calls" element={<CallCenter />} />
        <Route path="/voice-training" element={<VoiceTraining />} />
        <Route path="/models" element={<ModelManager />} />
        <Route path="/training-data" element={<TrainingData />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/health-check" element={<HealthCheck />} />
      </Routes>
    </Layout>
  )
}

export default App
