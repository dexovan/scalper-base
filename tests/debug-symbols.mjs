// debug-symbols.mjs - Quick check for SOL/XRP symbols
import fs from 'fs';

try {
  const data = JSON.parse(fs.readFileSync('/home/aiuser/scalper-base/data/system/universe.v2.json', 'utf8'));

  console.log('🔍 Looking for SOL/XRP symbols...');

  const solSymbols = Object.keys(data.symbols).filter(s => s.toUpperCase().includes('SOL'));
  const xrpSymbols = Object.keys(data.symbols).filter(s => s.toUpperCase().includes('XRP'));

  console.log('SOL symbols:', solSymbols.slice(0, 10));
  console.log('XRP symbols:', xrpSymbols.slice(0, 10));

  // Broader search
  console.log('\nAll symbols containing S, O, L:');
  const solBroad = Object.keys(data.symbols).filter(s => s.includes('S') && s.includes('O') && s.includes('L')).slice(0, 10);
  console.log(solBroad);

  console.log('\nAll symbols containing X, R, P:');
  const xrpBroad = Object.keys(data.symbols).filter(s => s.includes('X') && s.includes('R') && s.includes('P')).slice(0, 10);
  console.log(xrpBroad);

  // Check for major cryptos
  const majors = ['BTC', 'ETH', 'BNB', 'ADA', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI', 'LTC'];

  console.log('\n📊 Available major crypto symbols:');
  majors.forEach(crypto => {
    const symbols = Object.keys(data.symbols).filter(s => s.includes(crypto + 'USDT'));
    if (symbols.length > 0) {
      console.log(`${crypto}: ${symbols.join(', ')}`);
    } else {
      console.log(`${crypto}: ❌ Not found`);
    }
  });

  console.log('\nCurrent Prime symbols:');
  const primeSymbols = Object.values(data.symbols).filter(s => s.category === 'Prime');
  primeSymbols.forEach(s => console.log(' -', s.symbol));

} catch (err) {
  console.error('Error:', err.message);
}
