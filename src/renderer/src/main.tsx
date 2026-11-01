import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// 本地字体：显示/数字用 IBM Plex Sans 变量字体，日期时刻用 Mono（unicode-range 自动分子集加载）
import '@fontsource-variable/ibm-plex-sans/wght.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
