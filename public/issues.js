class IssueView {
    constructor(accountClient, issueClient) {
        this.accountClient = accountClient;
        this.issueClient = issueClient;
        this.page = 0;
        this.pageSize = 15;
        this.users = [];
        this.issueTypes = [];
    }

    async init() {
        this.showSpinner('Initializing issues...');
        try {
            const [users, issueTypes] = await Promise.all([
                this.accountClient.listUsers(),
                this.issueClient.listIssueTypes()
            ]);
            this.users = users;
            this.issueTypes = issueTypes;
        } catch (err) {
            this.hideSpinner();
            $.notify('Could not initialize issues.\nSee console for more details.', 'error');
            console.error('Could not initialize issues.', err);
            return;
        }
        this.hideSpinner();

        this.initFiltering();
        this.initPagination();

        const $table = $('#issues-table');
        const $tbody = $table.find('tbody');

        // Enable buttons on rows that have been modified
        $tbody.on('change', (ev) => {
            const $target = $(ev.target);
            const $button = $target.closest('tr').find('button');
            $button.removeAttr('disabled');
            $('#update-issues-button').removeAttr('disabled');
        });

        // Update issue when button in its row is clicked
        $tbody.on('click', (ev) => {
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
                this.issueClient.updateIssue(issueId, attrs)
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
        $('#update-issues-button').on('click', () => {
            $('#issues-table button:enabled').trigger('click');
        });

        this.update();
    }

    initFiltering() {
        // Created by dropdown
        const $creatorPicker = $('#creator-picker');
        $creatorPicker.empty();
        $creatorPicker.append(`<option value="">(All)</option>`);
        for (const user of this.users) {
            $creatorPicker.append(`<option value="${user.uid}">${user.name}</option>`);
        }

        // Issue type and subtype dropdowns
        const $issueTypePicker = $('#issue-type-picker');
        $issueTypePicker.empty();
        $issueTypePicker.append(`<option value="">(All)</option>`);
        for (const issueType of this.issueTypes) {
            $issueTypePicker.append(`<option value="${issueType.id}">${issueType.title}</option>`);
        }
        $issueTypePicker.on('change', () => {
            const $issueSubtypePicker = $('#issue-subtype-picker');
            $issueSubtypePicker.empty();
            $issueSubtypePicker.append(`<option value="">(All)</option>`);
            const issueType = this.issueTypes.find(it => it.id === $issueTypePicker.val());
            if (issueType) {
                for (const issueSubtype of issueType.subtypes) {
                    $issueSubtypePicker.append(`<option value="${issueSubtype.id}">${issueSubtype.title}</option>`);
                }
            }
        });
        $issueTypePicker.trigger('change');

        // Update issues on any filter change
        $('#filter input, #filter select').on('change', () => {
            this.update();
        });
    }

    initPagination() {
        $('#prev-page-link').on('click', () => {
            if (this.page > 0) {
                this.page = this.page - 1;
                this.update();
            }
        });
        $('#next-page-link').on('click', () => {
            this.page = this.page + 1;
            this.update();
        });
    }

    async update() {
        const $container = $('#container');
        const $table = $('#issues-table');
        const $tbody = $table.find('tbody');
    
        $tbody.empty();
        this.showSpinner('Updating issues...');

        // Get issues based on the current filters
        let issues = [];
        try {
            const createdBy = $('#creator-picker').val();
            const issueType = $('#issue-type-picker').val();
            const issueSubtype = $('#issue-subtype-picker').val();
            const dueDate = $('#due-date-picker').val();
            issues = await this.issueClient.listIssues(createdBy || null, dueDate || null, issueType || null, issueSubtype || null, this.page * this.pageSize, this.pageSize);
        } catch (err) {
            $container.append(`<div class="alert alert-dismissible alert-warning">${err}</div>`);
        } finally {
            this.hideSpinner();
        }

        const generateIssueTypeSelect = (issueTypeId) => `
            <select class="custom-select custom-select-sm issue-type">
                ${this.issueTypes.map(issueType => `<option value="${issueType.id}" ${(issueType.id === issueTypeId) ? 'selected' : ''}>${issueType.title}</option>`)}
            </select>
        `;
    
        const generateOwnerSelect = (ownerId) => `
            <select class="custom-select custom-select-sm issue-owner">
                ${this.users.map(user => `<option value="${user.uid}" ${(user.uid === ownerId) ? 'selected' : ''}>${user.name}</option>`)}
            </select>
        `;
    
        $('#pagination li.page-item.disabled span').text(`Issues ${this.page * this.pageSize + 1}-${(this.page + 1) * this.pageSize}`);
    
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

    showSpinner(message = 'Loading...') {
        $('#container').append(`
            <div id="issues-loading-spinner" class="d-flex justify-content-center">
                <div class="spinner-border text-primary" role="status">
                    <span class="sr-only">${message}</span>
                </div>
            </div>
        `);
    }

    hideSpinner() {
        $('#issues-loading-spinner').remove();
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
