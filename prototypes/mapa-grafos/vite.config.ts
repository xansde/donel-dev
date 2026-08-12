import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Bancada descartável (wi-esteira4-mapa-grafos-prototipo). Precisa importar
// arquivos fora da raiz do protótipo: o grafo-mesa.json em .esteira/ e o
// tokens.css em design-system/ — ambos vivem acima de prototypes/mapa-grafos/.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: ['../..'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@xyflow/react') || id.includes('elkjs')) {
              return 'vendor-reactflow';
            }
            if (id.includes('cytoscape')) {
              return 'vendor-cytoscape';
            }
            if (id.includes('reaflow')) {
              return 'vendor-reaflow';
            }
            if (id.includes('react-dom') || id.includes(`${'react'}/`) || id === 'react') {
              return 'vendor-react';
            }
          }
          return undefined;
        },
      },
    },
  },
});
