import { executeDataProvisioning } from './data-demo-load';

/**
 * Enterprise-scale data provisioning for performance testing and
 * high-density environment simulation.
 */
executeDataProvisioning({
  preset: 'large',
  dataSource: 'enterprise-simulation',
  clearTaggedData: true,
  batchIdPrefix: 'ent-sim',
  resetCommand: 'npm run data:env:reset'
}).catch((error) => {
  console.error('❌ Environment provisioning failed:', error);
  process.exitCode = 1;
});
