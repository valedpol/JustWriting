import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Backlog from './Backlog.jsx'

const page = window.location.pathname === '/backlog' || window.location.pathname === '/backlog/'
  ? <Backlog />
  : <App />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {page}
  </StrictMode>,
)
