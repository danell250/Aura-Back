"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const data_demo_load_1 = require("./data-demo-load");
(0, data_demo_load_1.runDataDemoData)({
    preset: 'large',
    dataSource: 'large-data',
    clearTaggedData: true,
    batchIdPrefix: 'large-data',
    resetCommand: 'npm run data:large:reset'
}).catch((error) => {
    console.error('❌ Large data load failed:', error);
    process.exitCode = 1;
});
