#!/usr/bin/env node

// Usage:
//    1. Visit this application's web interface (for example, https://bim360-issue-editor.herokuapp.com)
//    2. Navigate to the issue page for one of your BIM360 projects
//    3. Use the "Command-Line Config" button at the bottom of the page to generate a configuration JSON, and store it locally
//    4. Run the following command from the command line:
//        node bim360-to-excel.js <path/to/stored/config.json> <path/to/output.xlsx>

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
