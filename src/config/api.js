const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:8080',
  WS_URL:   import.meta.env.VITE_WS_URL  || 'ws://localhost:8080/call-signaling',
};

console.log('🔧 API Configuration:');
console.log('BASE_URL:', API_CONFIG.BASE_URL);
console.log('WS_URL:', API_CONFIG.WS_URL);
console.log('Environment:', import.meta.env.MODE);

export default API_CONFIG;