import { runSeedDemoData } from './seed-demo-data';

runSeedDemoData({
  preset: 'large',
  seedSource: 'seed-large-data',
  clearAllSeeded: true,
  batchIdPrefix: 'large-seed',
  resetCommand: 'npm run seed:large:reset'
}).catch((error) => {
  console.error('❌ Large seed failed:', error);
  process.exitCode = 1;
});
