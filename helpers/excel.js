const { BIM360Client } = require('forge-server-utils');
const ExcelJS = require('exceljs');

/**
 * Exports BIM360 issues and related data into XLSX spreadsheet.
 * @async
 * @param {object} opts Export options.
 * @param {string} opts.client_id Forge client ID.
 * @param {string} opts.client_secret Forge client secret.
 * @param {string} opts.three_legged_token 3-legged access token for Forge requests requiring user context.
 * @param {string} opts.region Forge region ("US" or "EMEA").
 * @param {string} opts.hub_id BIM360 hub ID.
 * @param {string} opts.project_id BIM360 project ID.
 * @param {string} opts.issue_container_id BIM360 issues container ID.
 * @param {string} opts.location_container_id BIM360 locations container ID.
 * @returns {Promise<Buffer>} XLSX spreadsheet serialized into buffer.
 */
async function exportIssues(opts) {
    const {
        client_id,
        client_secret,
        three_legged_token,
        region,
        hub_id,
        project_id,
        issue_container_id,
        location_container_id
    } = opts;
    const appContextBIM360 = new BIM360Client({ client_id, client_secret }, undefined, region);
    const userContextBIM360 = new BIM360Client({ token: three_legged_token }, undefined, region);

    const [issues, types, users, locations, documents] = await Promise.all([
        loadIssues(userContextBIM360, issue_container_id),
        loadIssueTypes(userContextBIM360, issue_container_id),
        loadUsers(appContextBIM360, hub_id.replace('b.', '')),
        loadLocations(userContextBIM360, location_container_id),
        loadDocuments(userContextBIM360, hub_id, project_id)
    ]);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'bim360-issue-editor';
    fillIssues(workbook.addWorksheet('Issues'), issues, types, users, locations, documents);
    fillIssueTypes(workbook.addWorksheet('Types'), types);
    fillIssueOwners(workbook.addWorksheet('Owners'), users);
    fillIssueLocations(workbook.addWorksheet('Locations'), locations);
    fillIssueDocuments(workbook.addWorksheet('Documents'), documents);
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

async function loadIssues(bim360, issueContainerID) {
    let page = { offset: 0, limit: 128 };
    let issues = await bim360.listIssues(issueContainerID, {}, page);
    let results = [];
    while (issues.length > 0) {
        results = results.concat(issues);
        page.offset += issues.length;
        issues = await bim360.listIssues(issueContainerID, {}, page);
    }
    return results;
}

async function loadIssueTypes(bim360, issueContainerID) {
    const issueTypes = await bim360.listIssueTypes(issueContainerID, true);
    return issueTypes;
}

async function loadUsers(bim360, accountId) {
    const users = await bim360.listUsers(accountId);
    return users;
}

async function loadLocations(bim360, locationContainerID) {
    let results = [];
    try {
        let page = { offset: 0, limit: 128 };
        let locations = await bim360.listLocationNodes(locationContainerID, page);
        while (locations.length > 0) {
            results = results.concat(locations);
            page.offset += locations.length;  
            locations = bim360.listLocationNodes(locationContainerID, page); 
        }
    } catch(err) {
        console.warn('Could not load BIM360 locations. The "Locations" worksheet will be empty.');
    }
    return results;
}

async function loadDocuments(bim360, hubId, projectId) {
    let results = [];

    async function fillIssues(folderId) {
        const items = await bim360.listContents(projectId, folderId);
        for (const item of items) {
            switch (item.type) {
                case 'items':
                    results.push(item);
                    break;
                case 'folders':
                    await fillIssues(item.id);
                    break;
            }
        }
    }

    const folders = await bim360.listTopFolders(hubId, projectId);
    for (const folder of folders) {
        await fillIssues(folder.id);
    }

    return results;
}

function fillIssues(worksheet, issues, types, users, locations, documents) {
    const IssueTypeFormat = (issueSubtypeID) => {
        let issueTypeID, issueTypeName, issueSubtypeName;
        for (const issueType of types) {
            for (const issueSubtype of issueType.subtypes) {
                if (issueSubtype.id === issueSubtypeID) {
                    issueTypeID = issueType.id;
                    issueTypeName = issueType.title;
                    issueSubtypeName = issueSubtype.title;
                    break;
                }
            }
        }
        return issueTypeName ? `${issueTypeName} > ${issueSubtypeName} [${issueTypeID},${issueSubtypeID}]` : '';
    };

    const IssueOwnerFormat = (ownerID) => {
        const user = users.find(u => u.uid === ownerID);
        return user ? `${user.name} [${user.uid}]` : '';
    };

    const IssueLocationFormat = (locationID) => {
        const location = locations.find(l => l.id === locationID);
        return location ? `${location.name} [${location.id}]` : '';
    };

    const IssueDocumentFormat = (documentID) => {
        const document = documents.find(d => d.id === documentID);
        return document ? `${document.displayName} [${document.id}]` : '';
    };

    const IssueStatusValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"void,draft,open,closed"']
    };

    const IssueOwnerValidation = {
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
        formulae: ['Documents!C:C']
    };

    const IssueColumns = [
        { id: 'id',             propertyName: 'identifier',             columnTitle: 'ID',          columnWidth: 8,     locked: true },
        { id: 'type',           propertyName: 'ng_issue_subtype_id',    columnTitle: 'Type',        columnWidth: 16,    locked: true,   format: IssueTypeFormat },
        { id: 'title',          propertyName: 'title',                  columnTitle: 'Title',       columnWidth: 32,    locked: false },
        { id: 'description',    propertyName: 'description',            columnTitle: 'Description', columnWidth: 32,    locked: false },
        { id: 'owner',          propertyName: 'owner',                  columnTitle: 'Owner',       columnWidth: 16,    locked: true,   format: IssueOwnerFormat,       validation: IssueOwnerValidation },
        { id: 'location',       propertyName: 'lbs_location',           columnTitle: 'Location',    columnWidth: 16,    locked: true,   format: IssueLocationFormat,    validation: IssueLocationValidation },
        { id: 'document',       propertyName: 'target_urn',             columnTitle: 'Document',    columnWidth: 32,    locked: true,   format: IssueDocumentFormat,    validation: IssueDocumentValidation },
        { id: 'status',         propertyName: 'status',                 columnTitle: 'Status',      columnWidth: 16,    locked: false,                                  validation: IssueStatusValidation },
        { id: 'answer',         propertyName: 'answer',                 columnTitle: 'Answer',      columnWidth: 32,    locked: false },
        { id: 'comments',       propertyName: 'comment_count',          columnTitle: 'Comments',    columnWidth: 8,     locked: true },
        { id: 'attachments',    propertyName: 'attachment_count',       columnTitle: 'Attachments', columnWidth: 8,     locked: true }
    ];

    worksheet.columns = IssueColumns.map(col => {
        return { key: col.id, header: col.columnTitle, width: col.columnWidth };
    });
    for (const issue of issues) {
        let row = {};
        for (const column of IssueColumns) {
            if (column.format) {
                row[column.id] = column.format(issue[column.propertyName]);
            } else {
                row[column.id] = issue[column.propertyName];
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
                'type-full': `${issueType.title} > ${issueSubtype.title} [${issueType.id},${issueSubtype.id}]`
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
            'user-id': user.uid,
            'user-name': user.name,
            'user-full': `${user.name} [${user.uid}]`
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
            'location-full': `${location.name} [${location.id}]`
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
        { key: 'document-full', header: '', width: 64 } // Full representation to show in the "issues" worksheet (that can be later decoded back into IDs)
    ];

    for (const item of documents) {
        worksheet.addRow({
            'document-urn': item.id,
            'document-name': item.displayName,
            'document-full': `${item.displayName} [${item.id}]`
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

module.exports = {
    exportIssues
};
