import { runDataDemoData } from './seed-demo-data';

runDataDemoData({
  preset: 'large',
  dataSource: 'large-data',
  clearTaggedData: true,
  batchIdPrefix: 'large-data',
  resetCommand: 'npm run seed:large:reset'
}).catch((error) => {
  console.error('❌ Large data load failed:', error);
  process.exitCode = 1;
});
