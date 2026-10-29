import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import 'virtual:uno.css'
import AppConfigGuide from './components/AppConfigGuide'
import { loadAppConfig } from './lib/appConfig'

const root = createRoot(document.getElementById('root')!)

void loadAppConfig().then(
  () => {
    root.render(<App />)
  },
  (error: unknown) => {
    root.render(<AppConfigGuide error={error} />)
  },
)
