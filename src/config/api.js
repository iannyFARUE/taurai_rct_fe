const API_CONFIG = {
  // Use environment variables with fallbacks for development
  BASE_URL: process.env.REACT_APP_API_URL || 'http://localhost:8080',
  WS_URL: process.env.REACT_APP_WS_URL || 'ws://localhost:8080/call-signaling',
};

// Debug logging (remove in production)
console.log('🔧 API Configuration:');
console.log('BASE_URL:', API_CONFIG.BASE_URL);
console.log('WS_URL:', API_CONFIG.WS_URL);
console.log('Environment:', process.env.NODE_ENV);

export default API_CONFIG;