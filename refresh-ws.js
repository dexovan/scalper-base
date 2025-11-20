#!/usr/bin/env node

/**
 * Standalone script to refresh WebSocket subscription with updated Prime symbols
 * Usage: node refresh-ws.js
 */

import { refreshWebSocketSubscription } from './src/connectors/bybitPublic.js';

async function main() {
  console.log('🔄 Refreshing WebSocket subscription...');

  try {
    await refreshWebSocketSubscription();
    console.log('✅ WebSocket subscription refreshed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error refreshing WebSocket:', error.message);
    process.exit(1);
  }
}

main();
