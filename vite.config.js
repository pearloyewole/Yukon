import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 5173, // Default Vite port
  },
  // Support client-side routing - serve index.html for all routes
  appType: 'spa',
})

