$.notify.defaults({
    showAnimation: 'fadeIn',
    hideAnimation: 'fadeOut'
});

let page = 0;

// Initialize UI
async function init(accountId, issueContainerId) {
    const accountClient = new AccountClient(accountId);
    const issueClient = new IssueClient(issueContainerId);

    await initFiltering(issueClient, accountClient);
    await initPagination(issueClient, accountClient);

    const $table = $('#issues-table');
    const $tbody = $table.find('tbody');

    // Enable buttons on rows that have been modified
    $tbody.on('change', function (ev) {
        const $target = $(ev.target);
        const $button = $target.closest('tr').find('button');
        $button.removeAttr('disabled');
        $('#update-issues-button').removeAttr('disabled');
    });

    // Update issue when button in its row is clicked
    $tbody.on('click', function (ev) {
        const $target = $(ev.target);
        if ($target.data('issue-id')) {
            const issueId = $target.data('issue-id');
            const $tr = $target.closest('tr');
            const attrs = {
                title: $tr.find('input.issue-title').val(),
                description: $tr.find('input.issue-description').val(),
                status: $tr.find('input.issue-status').val(),
                owner: $tr.find('input.issue-owner').val(),
                answer: $tr.find('input.issue-answer').val(),
                ng_issue_type_id: $tr.find('input.issue-type').val()
            };
            issueClient.updateIssue(issueId, attrs)
                .then(function (issue) {
                    $target.closest('button').attr('disabled', true);
                    // If no other buttons are enabled, disable the "update all" button as well
                    if ($('#issues-table button:enabled').length === 0) {
                        $('#update-issues-button').attr('disabled', true);
                    }
                    $.notify('Issue(s) successfully updated.', 'success');
                    console.log('Issue(s) successfully updated.', issue);
                })
                .catch(function (err) {
                    $.notify('Could not update issue(s).\nSee console for more details.', 'error');
                    console.error('Could not update issue(s).', err);
                });
        }
    });

    // Setup button for updating all modified issues
    $('#update-issues-button').on('click', function () {
        $('#issues-table button:enabled').trigger('click');
    });

    refreshIssues(issueClient, accountClient);
}

async function initFiltering(issueClient, accountClient) {
    let users = [];
    try {
        users = await accountClient.listUsers();
    } catch (err) {
        console.warn('Could not obtain account users. Their list will not be available in the UI.', err);
    }

    const $creatorPicker = $('#creator-picker');
    $creatorPicker.empty();
    $creatorPicker.append(`<option value="">(All)</option>`);
    for (const user of users) {
        $creatorPicker.append(`<option value="${user.uid}">${user.name}</option>`);
    }

    let issueTypes = [];
    try {
        issueTypes = await issueClient.listIssueTypes();
    } catch(err) {
        console.warn('Could not obtain issue types. Their list will not be available in the UI.', err);
    }

    const $issueTypePicker = $('#issue-type-picker');
    $issueTypePicker.empty();
    $issueTypePicker.append(`<option value="">(All)</option>`);
    for (const issueType of issueTypes) {
        $issueTypePicker.append(`<option value="${issueType.id}">${issueType.title}</option>`);
    }
    $issueTypePicker.on('change', function () {
        const $issueSubtypePicker = $('#issue-subtype-picker');
        $issueSubtypePicker.empty();
        $issueSubtypePicker.append(`<option value="">(All)</option>`);
        const issueType = issueTypes.find(it => it.id === $issueTypePicker.val());
        if (issueType) {
            for (const issueSubtype of issueType.subtypes) {
                $issueSubtypePicker.append(`<option value="${issueSubtype.id}">${issueSubtype.title}</option>`);
            }
        }
    });
    $issueTypePicker.trigger('change');

    $('#filter input, #filter select').on('change', function () {
        refreshIssues(issueClient, accountClient);
    });
}

async function initPagination(issueClient, accountClient) {
    $('#prev-page-link').on('click', function () {
        if (page > 0) {
            page = page - 1;
            refreshIssues(issueClient, accountClient);
        }
    });
    $('#next-page-link').on('click', function () {
        page = page + 1;
        refreshIssues(issueClient, accountClient);
    });
}

async function refreshIssues(issueClient, accountClient) {
    const $container = $('#container');
    const $table = $('#issues-table');
    const $tbody = $table.find('tbody');
    const pageSize = 15;

    $tbody.empty();
    $container.append(`
        <div id="issues-loading-spinner" class="d-flex justify-content-center">
            <div class="spinner-border text-primary" role="status">
                <span class="sr-only">Loading...</span>
            </div>
        </div>
    `);

    // Get users
    let users = [];
    try {
        users = await accountClient.listUsers();
    } catch (err) {
        console.warn('Could not obtain account users. Their list will not be available in the UI.', err);
    }

    // Get issues
    let issues = [];
    try {
        const createdBy = $('#creator-picker').val();
        const issueType = $('#issue-type-picker').val();
        const issueSubtype = $('#issue-subtype-picker').val();
        const dueDate = $('#due-date-picker').val();
        issues = await issueClient.listIssues(createdBy || null, dueDate || null, issueType || null, issueSubtype || null, page * pageSize, pageSize);
    } catch (err) {
        $container.append(`<div class="alert alert-dismissible alert-warning">${err}</div>`);
    } finally {
        $('#issues-loading-spinner').remove();
    }

    // Get issue types
    let issueTypes = [];
    try {
        issueTypes = await issueClient.listIssueTypes();
    } catch(err) {
        console.warn('Could not obtain issue types. Their list will not be available in the UI.', err);
    }

    const generateIssueTypeSelect = (issueTypeId) => `
        <select class="custom-select custom-select-sm issue-type">
            ${issueTypes.map(issueType => `<option value="${issueType.id}" ${(issueType.id === issueTypeId) ? 'selected' : ''}>${issueType.title}</option>`)}
        </select>
    `;

    const generateOwnerSelect = (ownerId) => `
        <select class="custom-select custom-select-sm issue-owner">
            ${users.map(user => `<option value="${user.uid}" ${(user.uid === ownerId) ? 'selected' : ''}>${user.name}</option>`)}
        </select>
    `;

    $('#pagination li.page-item.disabled span').text(`Issues ${page * pageSize + 1}-${(page + 1) * pageSize}`);

    // Update the table
    for (const issue of issues) {
        $tbody.append(`
            <tr>
                <td>
                    ${issue.identifier /* is this the property we want? */}
                </td>
                <td>
                    ${generateIssueTypeSelect(issue.ng_issue_type_id)}
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm issue-title" value="${issue.title}">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${issue.lbs_location /* is this the property we want? */}">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${issue.location_description /* is this the property we want? */}">
                </td>
                <td>
                    ${generateOwnerSelect(issue.owner)}
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${'' /* ? */}">
                </td>
                <!--<td>
                    <input type="text" class="form-control form-control-sm" value="${issue.attachment_count}">
                </td>-->
                <td>
                    <input type="text" class="form-control form-control-sm issue-description" value="${issue.description}">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm issue-answer" value="${issue.answer}">
                </td>
                <td>
                    <select class="custom-select custom-select-sm issue-status">
                        <option value="draft" ${(issue.status === 'draft') ? 'selected' : ''}>Draft</option>
                        <option value="open" ${(issue.status === 'open') ? 'selected' : ''}>Open</option>
                        <option value="close" ${(issue.status === 'close') ? 'selected' : ''}>Close</option>
                    </select>
                </td>
                <!--<td>
                    <input type="text" class="form-control form-control-sm" value="${issue.comment_count}">
                </td>-->
                <td>
                    <button type="button" data-issue-id="${issue.id}" class="btn btn-sm btn-outline-success" disabled>
                        <i data-issue-id="${issue.id}" class="fas fa-cloud-upload-alt"></i>
                    </button>
                </td>
            </tr>
        `);
    }
}

class IssueClient {
    constructor(issueContainerId) {
        this.issueContainerId = issueContainerId;
    }

    async _get(endpoint, params = {}) {
        const url = new URL(`/api/issues/${this.issueContainerId}` + endpoint, window.location.origin);
        for (const key of Object.keys(params)) {
            if (params[key]) {
                url.searchParams.append(key, params[key]);
            }
        }
        const response = await fetch(url.toString());
        if (response.ok) {
            const json = await response.json();
            return json;
        } else {
            const message = await response.text();
            throw new Error(message);
        }
    }

    async _patch(endpoint, body, params = {}) {
        const url = new URL(`/api/issues/${this.issueContainerId}` + endpoint, window.location.origin);
        for (const key of Object.keys(params)) {
            if (params[key]) {
                url.searchParams.append(key, params[key]);
            }
        }
        const response = await fetch(url.toString(), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            const json = await response.json();
            return json;
        } else {
            const message = await response.text();
            throw new Error(message);
        }
    }

    async listIssues(createdBy = null, dueDate = null, issueType = null, issueSubtype = null, offset = null, limit = null) {
        return this._get(``, {
            created_by: createdBy,
            due_date: dueDate,
            ng_issue_type_id: issueType,
            ng_issue_subtype_id: issueSubtype,
            offset, limit
        });
    }

    async updateIssue(issueId, attrs) {
        return this._patch(`/${issueId}`, attrs);
    }

    async listIssueComments(issueId, offset = null, limit = null) {
        return this._get(`/${issueId}/comments`, { offset, limit });
    }

    async listIssueAttachments(issueId, offset = null, limit = null) {
        return this._get(`/${issueId}/attachments`, { offset, limit });
    }

    async listRootCauses() {
        return this._get(`/root-causes`);
    }

    async listIssueTypes() {
        return this._get(`/issue-types`);
    }

    async listAttributeDefinitions() {
        return this._get(`/attr-definitions`);
    }

    async listAttributeMappings() {
        return this._get(`/attr-mappings`);
    }
}

class AccountClient {
    constructor(accountId) {
        this.accountId = accountId;
    }

    async _get(endpoint, params = {}) {
        const url = new URL(`/api/account/${this.accountId}` + endpoint, window.location.origin);
        for (const key of Object.keys(params)) {
            if (params[key]) {
                url.searchParams.append(key, params[key]);
            }
        }
        const response = await fetch(url.toString());
        if (response.ok) {
            const json = await response.json();
            return json;
        } else {
            const message = await response.text();
            throw new Error(message);
        }
    }

    async _patch(endpoint, body, params = {}) {
        const url = new URL(`/api/account/${this.accountId}` + endpoint, window.location.origin);
        for (const key of Object.keys(params)) {
            if (params[key]) {
                url.searchParams.append(key, params[key]);
            }
        }
        const response = await fetch(url.toString(), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            const json = await response.json();
            return json;
        } else {
            const message = await response.text();
            throw new Error(message);
        }
    }

    async listUsers() {
        return this._get(`/users`);
    }
}
