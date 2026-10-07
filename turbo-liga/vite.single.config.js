import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Genera un unico archivo HTML con todo el juego dentro (JS, CSS, texturas generadas por codigo).
// Se puede abrir con doble clic: los bots y el entrenamiento funcionan sin conexion, y las salas
// online usan WebRTC directo entre navegadores (el anfitrion hace de servidor).
export default defineConfig({
  define: { __SINGLE_FILE__: 'true' },
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2020',
    outDir: 'dist-single',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
});
