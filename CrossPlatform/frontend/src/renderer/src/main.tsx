import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'flexlayout-react/style/light.css'
import './styles.css'
import { App } from './App'

const root = document.getElementById('root')
if (!root)
  throw new Error('The application root element is missing.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
