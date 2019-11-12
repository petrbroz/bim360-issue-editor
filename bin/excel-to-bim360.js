#!/usr/bin/env node

// Usage:
//     node excel-to-bim360.js <path/to/config.json> <path/to/input.xlsx>

const fs = require('fs');
const { importIssues } = require('../helpers/excel');

async function run(configPath, inputPath) {
    let config = null;
    try {
        config = JSON.parse(fs.readFileSync(configPath));    
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
    const xlsx = fs.readFileSync(inputPath);
    const results = await importIssues(xlsx, config.issue_container_id, config.three_legged_token);
    console.log(JSON.stringify(results));
}

run(process.argv[2], process.argv[3]);
