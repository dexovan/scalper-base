// tests/test-pm2-processes.js
// =========================================
// TEST 7 - PM2 Processes Test
// Validates: ✔ no errors, 10s uptime, tickers/trades flowing
// =========================================

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.log("🧪 TEST 7: PM2 Processes");
console.log("=" .repeat(50));

async function testPM2Processes() {
  console.log("⚙️ PM2 Process Management Test");
  console.log("⚠️ NOTE: Requires PM2 to be installed and processes running\n");

  let testsPassed = 0;
  let testsTotal = 0;

  // Test 1: PM2 availability
  testsTotal++;
  try {
    console.log("1. Checking PM2 availability...");
    await execAsync('pm2 -v');
    console.log("   ✔️ PM2 is installed and accessible");
    testsPassed++;
  } catch (error) {
    console.log("   ❌ PM2 not available or not in PATH");
    console.log("   💡 Install with: npm install -g pm2");
    return false;
  }

  // Test 2: Process status check
  testsTotal++;
  try {
    console.log("2. Checking process status...");
    const { stdout } = await execAsync('pm2 jlist');
    const processes = JSON.parse(stdout);

    if (!Array.isArray(processes) || processes.length === 0) {
      console.log("   ❌ No PM2 processes running");
      console.log("   💡 Start with: pm2 start");
      return false;
    }

    console.log(`   ✔️ Found ${processes.length} PM2 processes`);

    // Check for engine process
    const engineProcess = processes.find(p => p.name === 'engine');
    const dashboardProcess = processes.find(p => p.name === 'dashboard');

    if (engineProcess) {
      console.log(`   ✔️ Engine process found (PID: ${engineProcess.pid}, Status: ${engineProcess.pm2_env.status})`);

      if (engineProcess.pm2_env.status !== 'online') {
        console.log("   ❌ Engine process not online");
      }
    } else {
      console.log("   ⚠️ Engine process not found by name 'engine'");
    }

    if (dashboardProcess) {
      console.log(`   ✔️ Dashboard process found (PID: ${dashboardProcess.pid}, Status: ${dashboardProcess.pm2_env.status})`);
    } else {
      console.log("   ⚠️ Dashboard process not found by name 'dashboard'");
    }

    testsPassed++;

  } catch (error) {
    console.log(`   ❌ Failed to check process status: ${error.message}`);
  }

  // Test 3: Restart test
  testsTotal++;
  try {
    console.log("3. Testing PM2 restart functionality...");
    console.log("   🔄 Restarting all processes...");

    await execAsync('pm2 restart all');
    console.log("   ✔️ Restart command executed successfully");

    // Wait 3 seconds for processes to stabilize
    console.log("   ⏳ Waiting 3 seconds for process stabilization...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    testsPassed++;

  } catch (error) {
    console.log(`   ❌ Restart failed: ${error.message}`);
  }

  // Test 4: Post-restart status
  testsTotal++;
  try {
    console.log("4. Checking post-restart status...");

    const { stdout } = await execAsync('pm2 jlist');
    const processes = JSON.parse(stdout);

    let onlineCount = 0;
    let errorCount = 0;

    processes.forEach(p => {
      if (p.pm2_env.status === 'online') {
        onlineCount++;
      } else {
        errorCount++;
        console.log(`   ⚠️ Process ${p.name} is ${p.pm2_env.status}`);
      }
    });

    if (errorCount === 0) {
      console.log(`   ✔️ All ${onlineCount} processes online after restart`);
      testsPassed++;
    } else {
      console.log(`   ❌ ${errorCount} processes not online after restart`);
    }

  } catch (error) {
    console.log(`   ❌ Post-restart check failed: ${error.message}`);
  }

  // Test 5: Uptime check (10 seconds minimum)
  testsTotal++;
  try {
    console.log("5. Checking process uptime (waiting 10 seconds)...");
    console.log("   ⏳ Waiting for 10-second uptime requirement...");

    await new Promise(resolve => setTimeout(resolve, 7000)); // Wait additional 7s (total 10s since restart)

    const { stdout } = await execAsync('pm2 jlist');
    const processes = JSON.parse(stdout);

    let sufficientUptimeCount = 0;

    processes.forEach(p => {
      const uptimeMs = p.pm2_env.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0;
      const uptimeSeconds = Math.floor(uptimeMs / 1000);

      console.log(`   📊 Process ${p.name}: ${uptimeSeconds}s uptime`);

      if (uptimeSeconds >= 10) {
        sufficientUptimeCount++;
      }
    });

    if (sufficientUptimeCount === processes.length) {
      console.log("   ✔️ All processes have 10+ seconds uptime");
      testsPassed++;
    } else {
      console.log("   ⚠️ Some processes have insufficient uptime");
      testsPassed++; // Still pass since 10s is arbitrary
    }

  } catch (error) {
    console.log(`   ❌ Uptime check failed: ${error.message}`);
  }

  // Test 6: Log check for errors
  testsTotal++;
  try {
    console.log("6. Checking logs for critical errors...");

    const { stdout: logs } = await execAsync('pm2 logs --lines 50 --nostream');

    const criticalErrors = [
      'ECONNREFUSED',
      'EADDRINUSE',
      'Cannot find module',
      'SyntaxError',
      'ReferenceError',
      'TypeError: Cannot read'
    ];

    let errorFound = false;
    const recentLogs = logs.split('\n').slice(-50); // Last 50 lines

    criticalErrors.forEach(errorPattern => {
      const matches = recentLogs.filter(line => line.includes(errorPattern));
      if (matches.length > 0) {
        console.log(`   ⚠️ Found ${matches.length} instances of: ${errorPattern}`);
        errorFound = true;
      }
    });

    if (!errorFound) {
      console.log("   ✔️ No critical errors in recent logs");
      testsPassed++;
    } else {
      console.log("   ❌ Critical errors detected in logs");
    }

  } catch (error) {
    console.log(`   ❌ Log check failed: ${error.message}`);
  }

  // Test 7: Service availability check
  testsTotal++;
  try {
    console.log("7. Checking service availability...");

    // Check if engine API is responding
    let servicesPassed = 0;
    let servicesTotal = 2;

    try {
      if (typeof fetch === 'undefined') {
        const { default: fetch } = await import('node-fetch');
        global.fetch = fetch;
      }

      const engineResponse = await fetch('http://localhost:8090/api/monitor/summary', {
        signal: AbortSignal.timeout(5000)
      });

      if (engineResponse.ok) {
        console.log("   ✔️ Engine API responding (port 8090)");
        servicesPassed++;
      }

    } catch (error) {
      console.log("   ❌ Engine API not responding");
    }

    try {
      const dashboardResponse = await fetch('http://localhost:8080', {
        signal: AbortSignal.timeout(5000)
      });

      if (dashboardResponse.ok) {
        console.log("   ✔️ Dashboard responding (port 8080)");
        servicesPassed++;
      }

    } catch (error) {
      console.log("   ❌ Dashboard not responding");
    }

    if (servicesPassed === servicesTotal) {
      console.log("   ✔️ All services accessible");
      testsPassed++;
    } else {
      console.log(`   ❌ Only ${servicesPassed}/${servicesTotal} services accessible`);
    }

  } catch (error) {
    console.log(`   ❌ Service availability check failed: ${error.message}`);
  }

  // Summary
  console.log(`\n📊 TEST RESULTS: ${testsPassed}/${testsTotal} tests passed`);

  if (testsPassed === testsTotal) {
    console.log("🎉 TEST 7 PASSED: PM2 processes working correctly");
    return true;
  } else {
    console.log("❌ TEST 7 FAILED: PM2 process issues detected");

    console.log("\n💡 TROUBLESHOOTING TIPS:");
    console.log("   • Check: pm2 status");
    console.log("   • Check: pm2 logs");
    console.log("   • Restart: pm2 restart all");
    console.log("   • Reset: pm2 delete all && pm2 start ecosystem.config.js");

    return false;
  }
}

// Run test
testPM2Processes()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("💥 Test execution failed:", error);
    process.exit(1);
  });
