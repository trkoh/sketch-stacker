import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/sketch-stacker/',
  server: {
    host: true, // 全ホストにバインド（Dev Container対応）
    port: 5173,
    proxy: {
      '/api/cloudfront': {
        target: 'https://d3a21s3joww9j4.cloudfront.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cloudfront/, ''),
        secure: true, // HTTPS証明書を検証
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('Proxy error:', err);
          });
          proxy.on('proxyRes', (proxyRes) => {
            // CORS ヘッダーを追加
            proxyRes.headers['access-control-allow-origin'] = '*';
            proxyRes.headers['access-control-allow-methods'] = 'GET,HEAD,OPTIONS';
            proxyRes.headers['access-control-allow-headers'] = 'Origin,X-Requested-With,Content-Type,Accept';
          });
        }
      }
    }
  }
})
