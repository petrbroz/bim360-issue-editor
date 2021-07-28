const { BIM360Client } = require('forge-server-utils');
const axios = require('axios').default;
const ExcelJS = require('exceljs');

/**
 * Exports BIM360 issues and related data into XLSX spreadsheet.
 * @async
 * @param {object} opts Export options.
 * @param {string} opts.two_legged_token 2-legged access token for Forge requests requiring app context.
 * @param {string} opts.three_legged_token 3-legged access token for Forge requests requiring user context.
 * @param {string} opts.region Forge region ("US" or "EMEA").
 * @param {string} opts.hub_id BIM360 hub ID.
 * @param {string} opts.project_id BIM360 project ID.
 * @param {string} opts.issue_container_id BIM360 issues container ID.
 * @param {string} opts.location_container_id BIM360 locations container ID.
 * @param {number} [opts.page_offset] Offset of the issue page to export.
 * @param {number} [opts.page_limit] Length of the issue page to export.
 * @returns {Promise<Buffer>} XLSX spreadsheet serialized into buffer.
 */
async function exportIssues(opts) {
    const {
        two_legged_token,
        three_legged_token,
        region,
        hub_id,
        project_id,
        issue_container_id,
        location_container_id,
        page_offset,
        page_limit
    } = opts;
    const appContextBIM360 = new BIM360Client({ token: two_legged_token }, undefined, region);
    const userContextBIM360 = new BIM360Client({ token: three_legged_token }, undefined, region);

    console.log('Fetching BIM360 data for export.');
    const [issues, types, users, locations, customAttributes] = await Promise.all([
        loadIssues(userContextBIM360, issue_container_id, page_offset, page_limit),
        loadIssueTypes(userContextBIM360, issue_container_id),
        loadUsers(project_id, two_legged_token),
        loadLocations(userContextBIM360, location_container_id),
        loadCustomAttributes(userContextBIM360, issue_container_id)
    ]);
    const documents = await loadReferencedDocuments(userContextBIM360, project_id, issues);

    console.log('Generating XLSX spreadsheet.');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'bim360-issue-editor';
    fillIssues(workbook.addWorksheet('Issues'), issues, types, users, locations, customAttributes, documents);
    fillIssueTypes(workbook.addWorksheet('Types'), types);
    fillIssueOwners(workbook.addWorksheet('Owners'), users);
    fillIssueLocations(workbook.addWorksheet('Locations'), locations);
    fillIssueDocuments(workbook.addWorksheet('Documents'), documents);
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

async function loadIssues(bim360, issueContainerID, offset, limit) {
    let page = { offset: offset || 0, limit: limit || 128 };
    console.log('Fetching BIM360 issues page:', page);
    let issues = await bim360.listIssues(issueContainerID, {}, page);
    if ((typeof offset !== 'undefined') || (typeof limit !== 'undefined')) {
        return issues;
    }
    let results = [];
    while (issues.length > 0) {
        results = results.concat(issues);
        page.offset += issues.length;
        console.log('Fetching BIM360 issues page:', page);
        issues = await bim360.listIssues(issueContainerID, {}, page);
    }
    return results;
}

async function loadIssueTypes(bim360, issueContainerID) {
    console.log('Fetching BIM360 issue types.');
    const issueTypes = await bim360.listIssueTypes(issueContainerID, true);
    return issueTypes;
}

async function loadUsers(projectId, token) {
    const PageSize = 64;
    console.log('Fetching BIM360 project users.');

    let url = `https://developer.api.autodesk.com/bim360/admin/v1/projects/${projectId}/users?limit=${PageSize}`;
    let opts = {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    };
    let response = await axios.get(url, opts);
    let results = response.data.results;
    while (response.data.pagination && response.data.pagination.nextUrl) {
        url = response.data.pagination.nextUrl;
        response = await axios.get(url, opts);
        results = results.concat(response.data.results);
    }
    return results;
}

async function loadLocations(bim360, locationContainerID) {
    let results = [];
    try {
        let page = { offset: 0, limit: 128 };
        console.log('Fetching BIM360 locations page:', page);
        let locations = await bim360.listLocationNodes(locationContainerID, page);
        while (locations.length > 0) {
            results = results.concat(locations);
            page.offset += locations.length;
            console.log('Fetching BIM360 locations page:', page);
            locations = await bim360.listLocationNodes(locationContainerID, page); 
        }
    } catch (err) {
        console.warn('Could not load BIM360 locations. The "Locations" worksheet will be empty.');
    }
    return results;
}

async function loadCustomAttributes(bim360, issueContainerID) {
    const attrDefinitions = await bim360.listIssueAttributeDefinitions(issueContainerID);
    return attrDefinitions;
}

async function loadDocuments(bim360, hubId, projectId) {
    // let results = [];
    // async function collect(folderId) {
    //     const items = await bim360.listContents(projectId, folderId);
    //     const subtasks = [];
    //     for (const item of items) {
    //         switch (item.type) {
    //             case 'items':
    //                 results.push(item);
    //                 break;
    //             case 'folders':
    //                 subtasks.push(collect(item.id));
    //                 break;
    //         }
    //     }
    //     await Promise.all(subtasks);
    // }
    async function listFolderContents(projectId, folderId, token) {
        let url = `https://developer.api.autodesk.com/data/v1/projects/${projectId}/folders/${folderId}/search`;
        let opts = {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };
        let response = await axios.get(url, opts);
        let results = response.data.data;
        while (response.data.links && response.data.links.next) {
            url = response.data.links.next.href;
            response = await axios.get(url, opts);
            results = results.concat(response.data.data);
        }
        return results;
    }

    console.log('Fetching BIM360 documents');
    const folders = await bim360.listTopFolders(hubId, projectId);
    const tasks = folders.map(folder => listFolderContents(projectId, folder.id, bim360.token));
    const results = await Promise.all(tasks);
    return [].concat.apply([], results);
}

async function loadReferencedDocuments(bim360, projectId, issues) {
    // Extract target_urn from issues array then filter null & duplicate urns 
    const issuesTargetUrns = issues.map(issue => issue.target_urn);
    const uniqueIssuesTargetUrns = issuesTargetUrns.filter((value, index, self) => value && self.indexOf(value) === index);

    // Slice the unique TargetUrns coming from issues into chunks of 50 each
    const chunkSize = 50;
    let uniqueIssuesTargetUrnsChuncks = [];
    for (let i = 0; i < uniqueIssuesTargetUrns.length; i += chunkSize) {
        const chunk = uniqueIssuesTargetUrns.slice(i, i + chunkSize);
        uniqueIssuesTargetUrnsChuncks.push(chunk);
    }

    async function listItems(projectId, targetUrns, token) {
        let url = `https://developer.api.autodesk.com/data/v1/projects/${projectId}/commands`;
        let opts = {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/vnd.api+json'
            }
        };
        let requestTargetUrns = targetUrns.map(targetUrn => ({ "type": "items", "id": targetUrn }));
        let data = {
            "jsonapi": {
                "version": "1.0"
            },
            "data": {
                "type": "commands",
                "attributes": {
                    "extension": {
                        "type": "commands:autodesk.core:ListItems",
                        "version": "1.1.0",
                        "data": {
                            "includePathInProject": true
                        }
                    }
                },
                "relationships": {
                    "resources": {
                        "data": requestTargetUrns
                    }
                }
            }
        };

        let response = await axios.post(url, data, opts);
        let results = response.data.data;
        return results;
    }

    let retries = 0;
    let referencedDocuments = [];
    for (let i = 0; i < uniqueIssuesTargetUrnsChuncks.length; i++) {
        console.log("Fetching BIM360 documents page:", i);
        try {
            const results = await listItems(projectId, uniqueIssuesTargetUrnsChuncks[i], bim360.token);
            referencedDocuments = referencedDocuments.concat(results.relationships.resources.data);
            retries = 0;
        } catch (err) {
            if (err.isAxiosError && err.response.status == 429) {
                const retryAfter = parseInt(err.response.headers["retry-after"]);
                if (retryAfter) {
                    console.error(`Rate limit: API Quota limit exceeded. Retrying after ${retryAfter} seconds`); 
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                }
                if (retries++ <= 3)
                    i--; // Retry for 3 times 
            } else {
                console.error(err);
            }
        }
    }

    console.log(`Collected data on ${referencedDocuments.length} BIM360 documents`);
    return referencedDocuments;
}

function fillIssues(worksheet, issues, types, users, locations, customAttributes, documents) {
    const IssueTypeFormat = (issueSubtypeID) => {
        let issueTypeID, issueTypeName, issueSubtypeName;
        for (const issueType of types) {
            for (const issueSubtype of issueType.subtypes) {
                if (issueSubtype.id === issueSubtypeID) {
                    issueTypeID = issueType.id;
                    issueTypeName = issueType.title;
                    issueSubtypeName = issueSubtype.title;
                    return encodeNameID(`${issueTypeName} > ${issueSubtypeName}`, `${issueTypeID},${issueSubtypeID}`);
                }
            }
        }
        return '';
    };

    const IssueUserFormat = (ownerID) => {
        const user = users.find(u => u.autodeskId === ownerID);
        if (user) {
            return encodeNameID(user.name, user.autodeskId);
        } else {
            return '';
        }
    };

    const IssueDateFormat = (issueDateString) => {
        if (issueDateString) {
            let issueDate = new Date(issueDateString);
            return issueDate.toISOString().replace(/T/, ' ').replace(/\..+/, '');
        } else {
            return '';
        }
    };

    const IssueLocationFormat = (locationID) => {
        const location = locations.find(l => l.id === locationID);
        if (location) {
            return encodeNameID(location.name, location.id);
        } else {
            return '';
        }
    };

    const IssueCustomAttributeListFormat = (customAttributeID, customAttributeValue) => {
        const issueCustomAttribute = customAttributes.find(c => c.id === customAttributeID);
        const issueCustomAttributeValue = issueCustomAttribute.metadata.list.options.find(option => option.id === customAttributeValue);
        return (issueCustomAttributeValue ? issueCustomAttributeValue.value : null);
    };

    const IssueDocumentFormat = (documentID) => {
        const document = documents.find(d => d.id === documentID);
        if (document) {
            return encodeNameID(document.meta.attributes.displayName, document.meta.attributes.pathInProject);
        } else {
            return '';
        }
    };

    const IssueTypeValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['Types!E:E']
    };

    const IssueStatusValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"void,draft,open,answered,work_completed,ready_to_inspect,in_dispute,not_approved,closed"']
    };

    const IssueUserValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['Owners!C:C']
    };

    const IssueLocationValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['Locations!D:D']
    };

    const IssueDocumentValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['Documents!D:D']
    };

    const IssueColumns = [
        { id: 'id',             propertyName: 'id',                     columnTitle: 'ID',          columnWidth: 8,     locked: true },
        { id: 'identifier',     propertyName: 'identifier',             columnTitle: '#',           columnWidth: 8,     locked: true },
        { id: 'type',           propertyName: 'ng_issue_subtype_id',    columnTitle: 'Type',        columnWidth: 16,    locked: true,   format: IssueTypeFormat,        validation: IssueTypeValidation },
        { id: 'title',          propertyName: 'title',                  columnTitle: 'Title',       columnWidth: 32,    locked: false },
        { id: 'description',    propertyName: 'description',            columnTitle: 'Description', columnWidth: 32,    locked: false },
        { id: 'created_by',     propertyName: 'created_by',             columnTitle: 'Created by',  columnWidth: 16,    locked: true,   format: IssueUserFormat },
        { id: 'updated_by',     propertyName: 'updated_by',             columnTitle: 'Updated by',  columnWidth: 16,    locked: true,   format: IssueUserFormat },
        { id: 'assigned_to',    propertyName: 'assigned_to',            columnTitle: 'Assigned to', columnWidth: 16,    locked: true,   format: IssueUserFormat },
        { id: 'assigned_to_type', propertyName: 'assigned_to_type',     columnTitle: 'Assignee type', columnWidth: 8,   locked: true },
        { id: 'owner',          propertyName: 'owner',                  columnTitle: 'Owner',       columnWidth: 16,    locked: true,   format: IssueUserFormat,       validation: IssueUserValidation },
        { id: 'created_at',     propertyName: 'created_at',             columnTitle: 'Created on',  columnWidth: 12,    locked: true,   format: IssueDateFormat },
        { id: 'updated_at',     propertyName: 'updated_at',             columnTitle: 'Updated on',  columnWidth: 12,    locked: true,   format: IssueDateFormat },
        { id: 'due_date',       propertyName: 'due_date',               columnTitle: 'Due date',    columnWidth: 12,    locked: true,   format: IssueDateFormat },
        { id: 'location',       propertyName: 'lbs_location',           columnTitle: 'Location',    columnWidth: 16,    locked: true,   format: IssueLocationFormat,    validation: IssueLocationValidation },
        { id: 'location_description', propertyName: 'location_description', columnTitle: 'Location details', columnWidth: 16,    locked: true },
        { id: 'document',       propertyName: 'target_urn',             columnTitle: 'Document',    columnWidth: 32,    locked: true,   format: IssueDocumentFormat,    validation: IssueDocumentValidation },
        { id: 'status',         propertyName: 'status',                 columnTitle: 'Status',      columnWidth: 16,    locked: false,                                  validation: IssueStatusValidation },
        { id: 'answer',         propertyName: 'answer',                 columnTitle: 'Answer',      columnWidth: 32,    locked: false },
        { id: 'comments',       propertyName: 'comment_count',          columnTitle: 'Comments',    columnWidth: 8,     locked: true },
        { id: 'attachments',    propertyName: 'attachment_count',       columnTitle: 'Attachments', columnWidth: 8,     locked: true }
    ];

    const issuesColumns = IssueColumns.map(col => {
        return { key: col.id, header: col.columnTitle, width: col.columnWidth };
    });
    // Define Custom Attributes Column headers
    const issuesCustomAttributesColumns = customAttributes.map(customAttribute => {
        return { key: customAttribute.id, header: customAttribute.title, width: 16 };
    });
    worksheet.columns = issuesColumns.concat(issuesCustomAttributesColumns);

    for (const issue of issues) {
        let row = {};
        for (const column of IssueColumns) {
            if (column.format) {
                row[column.id] = column.format(issue[column.propertyName]);
            } else {
                row[column.id] = issue[column.propertyName];
            }
        }
        // Add Custom Attributes value to row
        for (const customAttribute of customAttributes) {
            const issueCustomAttribute = issue.custom_attributes.find(c => c.id === customAttribute.id);
            if (issueCustomAttribute) {
                if (issueCustomAttribute.type == 'list') {
                    row[issueCustomAttribute.id] = IssueCustomAttributeListFormat(issueCustomAttribute.id, issueCustomAttribute.value);
                } else {
                    row[issueCustomAttribute.id] = issueCustomAttribute.value;
                }
            }
        }
        worksheet.addRow(row);
    }

    // Setup data validation and protection where needed
    for (const column of IssueColumns) {
        if (column.locked || column.validation) {
            worksheet.getColumn(column.id).eachCell(function (cell) {
                if (column.locked) {
                    cell.protection = {
                        locked: true
                    };
                }
                if (column.validation) {
                    cell.dataValidation = column.validation;
                }
            });
        }
    }
}

function fillIssueTypes(worksheet, issueTypes) {
    worksheet.columns = [
        { key: 'type-id', header: 'Type ID', width: 16 },
        { key: 'type-name', header: 'Type Name', width: 32 },
        { key: 'subtype-id', header: 'Subtype ID', width: 16 },
        { key: 'subtype-name', header: 'Subtype Name', width: 32 },
        { key: 'type-full', header: '', width: 64 } // Full representation to show in the "issues" worksheet (that can be later decoded back into IDs)
    ];

    for (const issueType of issueTypes) {
        for (const issueSubtype of issueType.subtypes) {
            worksheet.addRow({
                'type-id': issueType.id,
                'type-name': issueType.title,
                'subtype-id': issueSubtype.id,
                'subtype-name': issueSubtype.title,
                'type-full': encodeNameID(`${issueType.title} > ${issueSubtype.title}`, `${issueType.id},${issueSubtype.id}`)
            });
        }
    }

    // Setup data validation and protection where needed
    for (const column of worksheet.columns) {
        worksheet.getColumn(column.key).eachCell(function (cell) {
            cell.protection = {
                locked: true
            };
        });
    }
}

function fillIssueOwners(worksheet, users) {
    worksheet.columns = [
        { key: 'user-id', header: 'User ID', width: 16 },
        { key: 'user-name', header: 'User Name', width: 32 },
        { key: 'user-full', header: '', width: 64 } // Full representation to show in the "issues" worksheet (that can be later decoded back into IDs)
    ];

    for (const user of users) {
        worksheet.addRow({
            'user-id': user.autodeskId,
            'user-name': user.name,
            'user-full': encodeNameID(user.name, user.autodeskId)
        });
    }

    // Setup data validation and protection where needed
    for (const column of worksheet.columns) {
        worksheet.getColumn(column.key).eachCell(function (cell) {
            cell.protection = {
                locked: true
            };
        });
    }
}

function fillIssueLocations(worksheet, locations) {
    worksheet.columns = [
        { key: 'location-id', header: 'Location ID', width: 16 },
        { key: 'location-parent-id', header: 'Parent ID', width: 16 },
        { key: 'location-name', header: 'Location Name', width: 32 },
        { key: 'location-full', header: '', width: 64 } // Full representation to show in the "issues" worksheet (that can be later decoded back into IDs)
    ];

    for (const location of locations) {
        worksheet.addRow({
            'location-id': location.id,
            'location-parent-id': location.parentId,
            'location-name': location.name,
            'location-full': encodeNameID(location.name, location.id)
        });
    }

    // Setup data validation and protection where needed
    for (const column of worksheet.columns) {
        worksheet.getColumn(column.key).eachCell(function (cell) {
            cell.protection = {
                locked: true
            };
        });
    }
}

function fillIssueDocuments(worksheet, documents) {
    worksheet.columns = [
        { key: 'document-urn', header: 'Document URN', width: 16 },
        { key: 'document-name', header: 'Document Name', width: 32 },
        { key: 'document-path', header: 'Document Path', width: 64 },
        { key: 'document-full', header: '', width: 64 } // Full representation to show in the "issues" worksheet (that can be later decoded back into IDs)
    ];

    for (const document of documents) {
        const id = document.id;
        const displayName = document.meta.attributes.displayName;
        const pathInProject = document.meta.attributes.pathInProject;
        worksheet.addRow({
                'document-urn': id,
                'document-name': displayName,
                'document-path': pathInProject,
                'document-full': encodeNameID(displayName, pathInProject)
        });
    }

    // Setup data validation and protection where needed
    for (const column of worksheet.columns) {
        worksheet.getColumn(column.key).eachCell(function (cell) {
            cell.protection = {
                locked: true
            };
        });
    }
}

function encodeNameID(name, id) {
    return {
        'richText': [
            { 'text': `${name}` },
            { 'text': ` [${id}]`, font: { 'color': { 'argb': 'FFCCCCCC' } } }
        ]
    };
}

/**
 * Imports BIM360 issues from XLSX spreadsheet.
 * @async
 * @param {Buffer} buffer XLSX data.
 * @param {string} issueContainerID BIM360 issues container ID.
 * @param {string} threeLeggedToken 3-legged access token for Forge requests requiring user context.
 * @param {boolean} [sequential=false] Flag for updating issues sequentially instead of in bulk.
 * @param {array} [range=null] Array of two integers specifying the number range of rows to import.
 * @returns {object} Results object listing successfully created issues (in 'succeeded' property)
 * and errors (in 'failed' property).
 */
async function importIssues(buffer, issueContainerID, threeLeggedToken, sequential = false, range = null) {
    let results = {
        succeeded: [],
        failed: []
    };

    // If cell value contains rich text, convert it to regular text
    function unrich(val) {
        val = val || '';
        if (typeof val === 'object' && val.hasOwnProperty('richText')) {
            return val.richText.map(richText => richText.text).join('');
        } else {
            return val;
        }
    }

    console.log('Parsing XLSX spreadsheet.');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Issues');

    const bim360 = new BIM360Client({ token: threeLeggedToken });
    // Instead of blindly overwriting all fields from the spreadsheet,
    // fetch the latest state of the issues from BIM360 and only
    // update those that have (and _can_ be) changed.
    console.log('Fetching latest BIM360 issues.');
    const issues = await loadIssues(bim360, issueContainerID);

    if (sequential) {
        console.log('Parsing spreadsheet data.');
    } else {
        console.log('Updating BIM360 issues.');
    }

    const tasks = []; // Can be either promises, or objects with update params (if `sequential` mode is used)
    worksheet.eachRow(function (row, rowNumber) {
        if (rowNumber === 1) {
            return; // Skip the header row
        }

        if (range && (rowNumber < range[0] || rowNumber > range[1])) {
            return; // Skip row numbers not included in the `range` parameter
        }

        try {
            const issueID = row.values[1];
            const currentIssueAttributes = issues.find(issue => issue.id === issueID);
            const newIssueTypeMatch = unrich(row.values[3]).match(/.+\[(.+),(.+)\]$/);
            if (!newIssueTypeMatch) {
                results.failed.push({ id: issueID, row: rowNumber, error: 'Could not parse issue type and subtype IDs.' });
                return;
            }
            const newIssueOwner = unrich(row.values[10]).match(/.+\[(.+)\]$/);
            if (!newIssueOwner) {
                results.failed.push({ id: issueID, row: rowNumber, error: 'Could not parse issue owner ID.' });
                return;
            }
            const newIssueLocation = unrich(row.values[14]).match(/.+\[(.+)\]$/);
            // if (!newIssueLocation) {
            //     results.failed.push({ id: issueID, error: 'Could not parse issue location ID.' });
            //     return;
            // }
            const newIssueAttributes = {
                ng_issue_type_id: newIssueTypeMatch[1],
                ng_issue_subtype_id: newIssueTypeMatch[2],
                title: unrich(row.values[4]),
                description: unrich(row.values[5]),
                owner: newIssueOwner[1],
                lbs_location: newIssueLocation ? newIssueLocation[1] : null,
                location_description: unrich(row.values[15]),
                //document: ...
                status: unrich(row.values[17]),
                answer: unrich(row.values[18])
            };

            // Check if the issue exists in BIM360
            if (!currentIssueAttributes) {
                //results.failed.push({ id: issueID, row: rowNumber, error: 'Issue not found in BIM360.' });
                tasks.push(createIssue(bim360, issueContainerID, newIssueAttributes, results));
 
            }else{

                const issueNumber = currentIssueAttributes.identifier;

                // Check if any of the new issue properties differ from the original in BIM360, and if they *can* be changed
                let blockedAttributeUpdates = [];
                for (const key of Object.getOwnPropertyNames(newIssueAttributes)) {
                    if (currentIssueAttributes[key] == newIssueAttributes[key]) { // both values are equal
                        delete newIssueAttributes[key];
                    } else if (!currentIssueAttributes[key] && !newIssueAttributes[key]) { // both values are "falsy" (e.g., an empty string and a null)
                        delete newIssueAttributes[key];
                    } else if (currentIssueAttributes.permitted_attributes.indexOf(key) === -1) { // field change not permitted
                        blockedAttributeUpdates.push(key);
                    }
                }
                // if (blockedAttributeUpdates.length > 0) {
                //     results.failed.push({ number: issueNumber, id: issueID, error: `Changing these issue fields is not permitted: ${blockedAttributeUpdates.join(', ')}.` });
                //     return;
                // }
                if (Object.getOwnPropertyNames(newIssueAttributes).length === 0) {
                    return; // No fields to update
                }
    
                if (sequential) {
                    tasks.push({ bim360, issueContainerID, issueID, currentIssueAttributes, newIssueAttributes, blockedAttributeUpdates, issueNumber, results });
                } else {
                    tasks.push(updateIssue(bim360, issueContainerID, issueID, currentIssueAttributes, newIssueAttributes, blockedAttributeUpdates, issueNumber, results));
                }
            } 
        } catch (err) {
            console.error('Error when parsing spreadsheet row', rowNumber);
            throw new Error(err);
        }
    });

    if (sequential) {
        for (const task of tasks) {
            const { bim360, issueContainerID, issueID, currentIssueAttributes, newIssueAttributes, blockedAttributeUpdates, issueNumber, results } = task;
            console.log('Updating issue', issueID);
            await updateIssue(bim360, issueContainerID, issueID, currentIssueAttributes, newIssueAttributes, blockedAttributeUpdates, issueNumber, results);
        }
    } else {
        console.log('Waiting for all updates to complete.');
        await Promise.all(tasks);
    }

    return results;
}

async function updateIssue(bim360, issueContainerID, issueID, currentIssueAttributes, newIssueAttributes, blockedAttributes, issueNumber, results) {
    try {
        // If some attributes are not permitted to be changed, try temporarily switching to issue status "open"
        if (blockedAttributes.length > 0) {
            const _status = currentIssueAttributes.status;
            updatedIssue = await bim360.updateIssue(issueContainerID, issueID, { status: 'open' });
            updatedIssue = await bim360.updateIssue(issueContainerID, issueID, newIssueAttributes);
            if (!newIssueAttributes.status) {
                updatedIssue = await bim360.updateIssue(issueContainerID, issueID, { status: _status });
            }
            results.succeeded.push({
                number: issueNumber,
                id: issueID,
                issue: updatedIssue
            });
        } else {
            const updatedIssue = await bim360.updateIssue(issueContainerID, issueID, newIssueAttributes);
            results.succeeded.push({
                number: issueNumber,
                id: issueID,
                issue: updatedIssue
            });
        }
    } catch (err) {
        results.failed.push({
            number: issueNumber,
            id: issueID,
            error: JSON.stringify(err)
        });
    }
}

async function createIssue(bim360, issueContainerID, newIssueAttributes, results) {
    try { 
        const createdIssue = await bim360.createIssue(issueContainerID, newIssueAttributes);
        results.succeeded.push({
            number: createdIssue.identifier,
            id: createdIssue.id,
            issue: createdIssue
        }); 
    } catch (err) {
        results.failed.push({
            number: 'new issue failed- no number',
            id: 'new issue failed - no id',
            error: JSON.stringify(err)
        });
    }
}

module.exports = {
    exportIssues,
    importIssues
};
