import { runDataDemoData } from './data-demo-load';

runDataDemoData({
  preset: 'large',
  dataSource: 'large-data',
  clearTaggedData: true,
  batchIdPrefix: 'large-data',
  resetCommand: 'npm run data:large:reset'
}).catch((error) => {
  console.error('❌ Large data load failed:', error);
  process.exitCode = 1;
});
