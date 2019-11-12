#!/usr/bin/env node

// Usage:
//     node bim360-to-excel.js <path/to/config.json> <path/to/output.xlsx>

const fs = require('fs');
const { exportIssues } = require('../helpers/excel');

async function run(configPath, outputPath) {
    let config = null;
    try {
        config = JSON.parse(fs.readFileSync(configPath));    
    } catch(err) {
        console.error(err);
        process.exit(1);
    }

    const xlsx = await exportIssues(config);
    fs.writeFileSync(outputPath, xlsx);
}

run(process.argv[2], process.argv[3]);
