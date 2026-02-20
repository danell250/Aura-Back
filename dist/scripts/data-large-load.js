"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const data_demo_load_1 = require("./data-demo-load");
/**
 * Enterprise-scale data provisioning for performance testing and
 * high-density environment simulation.
 */
(0, data_demo_load_1.executeDataProvisioning)({
    preset: 'large',
    dataSource: 'enterprise-simulation',
    clearTaggedData: true,
    batchIdPrefix: 'ent-sim',
    resetCommand: 'npm run data:env:reset'
}).catch((error) => {
    console.error('❌ Environment provisioning failed:', error);
    process.exitCode = 1;
});
