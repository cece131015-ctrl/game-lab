import { createRoot } from 'react-dom/client';
import { Engine } from './engine.js';
import { EngineContext } from './ui/common.jsx';
import { App } from './ui/App.jsx';
import './styles.css';

const loading = document.getElementById('loading');
let engine;
try {
  engine = new Engine(document.getElementById('view'));
} catch (e) {
  loading.textContent = 'Tu navegador no soporta WebGL. Prueba con Chrome, Edge o Firefox actualizados.';
  throw e;
}

createRoot(document.getElementById('ui')).render(
  <EngineContext.Provider value={engine}>
    <App />
  </EngineContext.Provider>,
);
loading.classList.add('hidden');
