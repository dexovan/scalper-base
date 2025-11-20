// debug-symbols.mjs - Quick check for SOL/XRP symbols
import fs from 'fs';

try {
  const data = JSON.parse(fs.readFileSync('/home/aiuser/scalper-base/data/system/universe.v2.json', 'utf8'));

  console.log('🔍 Looking for SOL/XRP symbols...');

  const solSymbols = Object.keys(data.symbols).filter(s => s.includes('SOL'));
  const xrpSymbols = Object.keys(data.symbols).filter(s => s.includes('XRP'));

  console.log('SOL symbols:', solSymbols.slice(0, 5));
  console.log('XRP symbols:', xrpSymbols.slice(0, 5));

  console.log('\nCurrent Prime symbols:');
  const primeSymbols = Object.values(data.symbols).filter(s => s.category === 'Prime');
  primeSymbols.forEach(s => console.log(' -', s.symbol));

} catch (err) {
  console.error('Error:', err.message);
}
