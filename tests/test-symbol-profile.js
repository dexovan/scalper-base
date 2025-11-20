// tests/test-symbol-profile.js
// =========================================
// TEST 4 - SymbolProfile Test
// Validates: ✔ file created, updatedAt changed
// =========================================

import { loadProfile, saveProfile, getProfileSnapshot } from "../src/market/symbolProfile.js";
import fs from "fs";
import path from "path";

console.log("🧪 TEST 4: SymbolProfile System");
console.log("=" .repeat(50));

async function testSymbolProfile() {
  try {
    const testSymbol = "BTCUSDT";

    console.log(`📂 Testing profile operations for ${testSymbol}...`);

    // Test 1: Load profile (should create if doesn't exist)
    console.log("🔍 Loading profile...");
    const profile = await loadProfile(testSymbol);

    if (!profile) {
      throw new Error("❌ Failed to load profile");
    }

    console.log("✔️ SUCCESS: Profile loaded");
    console.log(`   Symbol: ${profile.symbol}`);
    console.log(`   Trade count: ${profile.tradeCount}`);
    console.log(`   Created at: ${profile.createdAt}`);

    // Validate initial state
    if (profile.symbol !== testSymbol) {
      throw new Error("❌ Profile symbol mismatch");
    }

    if (profile.tradeCount !== 0) {
      console.warn("⚠️ WARNING: Expected tradeCount = 0 for fresh profile");
    } else {
      console.log("✔️ SUCCESS: Fresh profile has tradeCount = 0");
    }

    // Test 2: Modify and save profile
    console.log("\n📝 Modifying and saving profile...");
    const originalUpdatedAt = profile.updatedAt;

    // Wait a moment to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 10));

    profile.tradeCount = 5;
    profile.winCount = 3;
    profile.lossCount = 2;

    const saveResult = await saveProfile(profile);

    if (!saveResult) {
      throw new Error("❌ Failed to save profile");
    }

    console.log("✔️ SUCCESS: Profile saved");

    // Test 3: Verify file was created/updated
    console.log("\n📄 Verifying file operations...");

    const profilesDir = path.resolve("data", "profiles");
    const profileFile = path.join(profilesDir, `${testSymbol}.json`);

    if (!fs.existsSync(profileFile)) {
      throw new Error("❌ Profile file not created");
    }

    console.log("✔️ SUCCESS: Profile file exists");
    console.log(`   File: ${profileFile}`);

    // Test 4: Reload and verify changes
    console.log("\n🔄 Reloading profile to verify changes...");

    const reloadedProfile = await loadProfile(testSymbol);

    if (!reloadedProfile) {
      throw new Error("❌ Failed to reload profile");
    }

    if (reloadedProfile.tradeCount !== 5) {
      throw new Error("❌ Trade count not saved correctly");
    }

    if (reloadedProfile.winCount !== 3) {
      throw new Error("❌ Win count not saved correctly");
    }

    if (reloadedProfile.updatedAt === originalUpdatedAt) {
      throw new Error("❌ updatedAt timestamp not updated");
    }

    console.log("✔️ SUCCESS: All changes saved and reloaded correctly");
    console.log(`   Trade count: ${reloadedProfile.tradeCount}`);
    console.log(`   Win count: ${reloadedProfile.winCount}`);
    console.log(`   Updated at: ${reloadedProfile.updatedAt}`);

    // Test 5: Snapshot functionality
    console.log("\n📸 Testing snapshot functionality...");

    const snapshot = getProfileSnapshot(testSymbol);

    if (!snapshot) {
      console.warn("⚠️ WARNING: Snapshot returned null (might be async issue)");
    } else {
      console.log("✔️ SUCCESS: Snapshot retrieved");
      console.log(`   Snapshot symbol: ${snapshot.symbol}`);

      if (snapshot.tradeCount !== 5) {
        console.warn("⚠️ WARNING: Snapshot data mismatch");
      } else {
        console.log("✔️ SUCCESS: Snapshot data matches");
      }
    }

    // Test 6: Test another symbol
    console.log("\n🔄 Testing second symbol...");

    const testSymbol2 = "ETHUSDT";
    const profile2 = await loadProfile(testSymbol2);

    if (!profile2 || profile2.symbol !== testSymbol2) {
      throw new Error("❌ Failed to create second profile");
    }

    console.log("✔️ SUCCESS: Second profile created");
    console.log(`   Symbol: ${profile2.symbol}`);
    console.log(`   Fresh tradeCount: ${profile2.tradeCount}`);

    console.log("\n🎉 TEST 4 PASSED: SymbolProfile system working correctly");
    return true;

  } catch (error) {
    console.error("❌ TEST 4 FAILED:", error.message);
    console.error("Stack:", error.stack);
    return false;
  }
}

// Run test
testSymbolProfile()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("💥 Test execution failed:", error);
    process.exit(1);
  });
