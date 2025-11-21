// Simple logger for Feature Engine
const logger = {
  info: (message, ...args) => {
    console.log(`[INFO] ${new Date().toISOString()}: ${message}`, ...args);
  },
  warn: (message, ...args) => {
    console.warn(`[WARN] ${new Date().toISOString()}: ${message}`, ...args);
  },
  error: (message, ...args) => {
    console.error(`[ERROR] ${new Date().toISOString()}: ${message}`, ...args);
  },
  debug: (message, ...args) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG] ${new Date().toISOString()}: ${message}`, ...args);
    }
  },
  child: (options = {}) => {
    const component = options.component || 'Unknown';
    return {
      info: (message, ...args) => {
        console.log(`[INFO] ${new Date().toISOString()} [${component}]: ${message}`, ...args);
      },
      warn: (message, ...args) => {
        console.warn(`[WARN] ${new Date().toISOString()} [${component}]: ${message}`, ...args);
      },
      error: (message, ...args) => {
        console.error(`[ERROR] ${new Date().toISOString()} [${component}]: ${message}`, ...args);
      },
      debug: (message, ...args) => {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[DEBUG] ${new Date().toISOString()} [${component}]: ${message}`, ...args);
        }
      },
      child: (childOptions = {}) => logger.child({ ...options, ...childOptions })
    };
  }
};

export default logger;
