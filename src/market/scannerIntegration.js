// ============================================================
// SIGNAL SCANNER INTEGRATION - Runs scanner INSIDE engine process
// Avoids HTTP overhead and ensures timing is perfect
// ============================================================

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dynamic import of scanner module
let scannerModule = null;

/**
 * Initialize scanner integration
 * Call this after engine WebSocket is fully connected
 */
export async function initializeScannerIntegration() {
  try {
    console.log('🔍 [SCANNER-INTEGRATION] Initializing signal scanner...');

    // Import scanner module (ESM)
    const scannerPath = path.resolve(__dirname, '../../scripts/scalp-signal-scanner.js');
    scannerModule = await import(scannerPath);

    console.log('✅ [SCANNER-INTEGRATION] Scanner module loaded');
    return true;
  } catch (error) {
    console.error('❌ [SCANNER-INTEGRATION] Failed to load scanner:', error.message);
    return false;
  }
}

/**
 * Start background scanner loops (full scan + fast track)
 * Returns object with control functions
 */
export async function startScannerLoops() {
  if (!scannerModule) {
    console.error('❌ [SCANNER-INTEGRATION] Scanner not initialized');
    return null;
  }

  try {
    console.log('🚀 [SCANNER-INTEGRATION] Starting scanner loops...');

    // Start full scan loop (30s)
    const fullScanInterval = setInterval(async () => {
      try {
        // Call scanAllSymbols if it exists
        if (scannerModule.scanAllSymbols) {
          await scannerModule.scanAllSymbols();
        }
      } catch (error) {
        console.error('[SCANNER-INTEGRATION] Full scan error:', error.message);
      }
    }, 30000); // 30 seconds

    // Start fast track loop (2s)
    const fastTrackInterval = setInterval(async () => {
      try {
        // Call fastTrackLoop if it exists
        if (scannerModule.fastTrackLoop) {
          await scannerModule.fastTrackLoop();
        }
      } catch (error) {
        // Silent fail for fast track
      }
    }, 2000); // 2 seconds

    console.log('✅ [SCANNER-INTEGRATION] Scanner loops started');
    console.log('   - Full scan: 30s interval');
    console.log('   - Fast track: 2s interval');

    // Return control object
    return {
      stop() {
        clearInterval(fullScanInterval);
        clearInterval(fastTrackInterval);
        console.log('⏹️  [SCANNER-INTEGRATION] Scanner loops stopped');
      }
    };
  } catch (error) {
    console.error('❌ [SCANNER-INTEGRATION] Failed to start scanner loops:', error.message);
    return null;
  }
}

/**
 * Check if scanner is available
 */
export function isScannerAvailable() {
  return scannerModule !== null;
}

export default {
  initializeScannerIntegration,
  startScannerLoops,
  isScannerAvailable
};
