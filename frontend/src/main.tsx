import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './styles/index.css'

// GitHub Pages serves a project site under /<repo>/. Vite's `base` (VITE_BASE_PATH) sets
// BASE_URL; the router uses the same prefix so /map, /reports, ... resolve under it.
// Deep links on Pages work because the deploy copies index.html to 404.html.
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
