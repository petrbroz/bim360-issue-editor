#!/usr/bin/env node

// Usage:
//    1. Run this application's server with `ENABLE_CLI_CONFIG` env. variable is set to true
//    2. Visit this application's web interface and navigate to the issue page for one of your BIM360 projects
//    3. Use the "Command-Line Config" button at the bottom of the page to generate a configuration JSON, and store it locally
//    4. Run the following command from the command line:
//        node excel-to-bim360.js <path/to/stored/config.json> <path/to/input.xlsx>

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
