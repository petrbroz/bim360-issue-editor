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

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'bim360-issue-editor';
    await Promise.all([
        fillIssues(workbook.addWorksheet('Issues'), userContextBIM360, issue_container_id),
        fillIssueTypes(workbook.addWorksheet('Types'), userContextBIM360, issue_container_id),
        fillIssueOwners(workbook.addWorksheet('Owners'), appContextBIM360, hub_id.replace('b.', '')),
        fillIssueLocations(workbook.addWorksheet('Locations'), userContextBIM360, location_container_id),
        fillIssueDocuments(workbook.addWorksheet('Documents'), userContextBIM360, hub_id, project_id)
    ]);
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

async function fillIssues(worksheet, bim360,  issueContainerID) {
    const IssueStatusValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"void,draft,open,closed"']
    };

    const IssueColumns = [
        { id: 'id',             propertyName: 'identifier',             columnTitle: 'ID',          columnWidth: 8,     locked: true },
        { id: 'type',           propertyName: 'ng_issue_type_id',       columnTitle: 'Type',        columnWidth: 16,    locked: true },
        { id: 'subtype',        propertyName: 'ng_issue_subtype_id',    columnTitle: 'Subtype',     columnWidth: 16,    locked: true },
        { id: 'title',          propertyName: 'title',                  columnTitle: 'Title',       columnWidth: 32,    locked: false },
        { id: 'description',    propertyName: 'description',            columnTitle: 'Description', columnWidth: 32,    locked: false },
        { id: 'owner',          propertyName: 'owner',                  columnTitle: 'Owner',       columnWidth: 16,    locked: true },
        { id: 'location',       propertyName: 'lbs_location',           columnTitle: 'Location',    columnWidth: 16,    locked: true },
        { id: 'document',       propertyName: 'target_urn',             columnTitle: 'Document',    columnWidth: 32,    locked: true },
        { id: 'status',         propertyName: 'status',                 columnTitle: 'Status',      columnWidth: 16,    locked: false,  validation: IssueStatusValidation },
        { id: 'answer',         propertyName: 'answer',                 columnTitle: 'Answer',      columnWidth: 32,    locked: false },
        { id: 'comments',       propertyName: 'comment_count',          columnTitle: 'Comments',    columnWidth: 8,     locked: true },
        { id: 'attachments',    propertyName: 'attachment_count',       columnTitle: 'Attachments', columnWidth: 8,     locked: true }
    ];

    worksheet.columns = IssueColumns.map(col => {
        return { key: col.id, header: col.columnTitle, width: col.columnWidth };
    });

    let page = { offset: 0, limit: 128 };
    let issues = await bim360.listIssues(issueContainerID, {}, page);
    while (issues.length > 0) {
        for (const issue of issues) {
            let row = {};
            for (const column of IssueColumns) {
                row[column.id] = issue[column.propertyName];
            }
            worksheet.addRow(row);
        }
        page.offset += issues.length;
        issues = await bim360.listIssues(issueContainerID, {}, page);
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

async function fillIssueTypes(worksheet, bim360,  issueContainerID) {
    worksheet.columns = [
        { key: 'type-id', header: 'Type ID', width: 16 },
        { key: 'type-name', header: 'Type Name', width: 32 },
        { key: 'subtype-id', header: 'Subtype ID', width: 16 },
        { key: 'subtype-name', header: 'Subtype Name', width: 32 },
    ];

    const issueTypes = await bim360.listIssueTypes(issueContainerID, true);
    for (const issueType of issueTypes) {
        for (const issueSubtype of issueType.subtypes) {
            worksheet.addRow({
                'type-id': issueType.id,
                'type-name': issueType.title,
                'subtype-id': issueSubtype.id,
                'subtype-name': issueSubtype.title
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

async function fillIssueOwners(worksheet, bim360, accountId) {
    worksheet.columns = [
        { key: 'user-id', header: 'User ID', width: 16 },
        { key: 'user-name', header: 'User Name', width: 32 }
    ];

    const users = await bim360.listUsers(accountId);
    for (const user of users) {
        worksheet.addRow({
            'user-id': user.uid,
            'user-name': user.name
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

async function fillIssueLocations(worksheet, bim360, locationContainerID) {
    worksheet.columns = [
        { key: 'location-id', header: 'Location ID', width: 16 },
        { key: 'location-parent-id', header: 'Parent ID', width: 16 },
        { key: 'location-name', header: 'Location Name', width: 32 }
    ];

    try {
        let page = { offset: 0, limit: 128 };
        let locations = await bim360.listLocationNodes(locationContainerID, page);
        while (locations.length > 0) {
            for (const location of locations) {
                worksheet.addRow({
                    'location-id': location.id,
                    'location-parent-id': location.parentId,
                    'location-name': location.name
                });
            }
            page.offset += locations.length;  
            locations = bim360.listLocationNodes(locationContainerID, page); 
        }
    } catch(err) {
        console.warn('Could not load BIM360 locations. The "Locations" worksheet will be empty.');
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

async function fillIssueDocuments(worksheet, bim360, hubId, projectId) {
    worksheet.columns = [
        { key: 'document-urn', header: 'Document URN', width: 16 },
        { key: 'document-name', header: 'Document Name', width: 32 }
    ];

    async function fillIssues(folderId) {
        const items = await bim360.listContents(projectId, folderId);
        for (const item of items) {
            switch (item.type) {
                case 'items':
                    worksheet.addRow({
                        'document-urn': item.id,
                        'document-name': item.displayName
                    });
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
