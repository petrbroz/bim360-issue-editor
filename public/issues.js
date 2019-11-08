class IssueView {
    constructor(accountClient, issueClient, locationClient, docsClient) {
        this.accountClient = accountClient;
        this.issueClient = issueClient;
        this.locationClient = locationClient;
        this.docsClient = docsClient;
        this.page = 0;
        this.pageSize = 15;
        this.users = [];
        this.issueTypes = [];
        this.locations = [];
    }

    async init() {
        this.showSpinner('Initializing issues...');
        try {
            const [users, issueTypes, locations] = await Promise.all([
                this.accountClient.listUsers(),
                this.issueClient.listIssueTypes(),
                this.locationClient.listLocations()
            ]);
            this.users = users;
            this.issueTypes = issueTypes;
            this.locations = locations;
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
            $target.closest('tr').find('button.update-issue').removeAttr('disabled');
            $('#update-issues-button').removeAttr('disabled');

            // If issue type is changed, update the corresponding subtype dropdown as well
            if ($target.hasClass('issue-type')) {
                const issueTypeId = $target.val();
                const issueType = this.issueTypes.find(it => it.id === issueTypeId);
                const issueSubtypes = issueType ? issueType.subtypes : [];
                const $issueSubtypeDropdown = $target.closest('tr').find('select.issue-subtype');
                $issueSubtypeDropdown.empty();
                for (const issueSubtype of issueSubtypes) {
                    $issueSubtypeDropdown.append(`<option value="${issueSubtype.id}">${issueSubtype.title}</option>`)
                }
            }
        });

        // Update issue when button in its row is clicked
        $tbody.on('click', (ev) => {
            const $target = $(ev.target);
            if ($target.hasClass('update-issue') && $target.data('issue-id')) {
                const issueId = $target.data('issue-id');
                const $tr = $target.closest('tr');
                const attrs = {};
                function addAttributeIfChanged(attrName, selector) {
                    const $el = $tr.find(selector);
                    const originalValue = $el.data('original-value');
                    const currentValue = $el.val();
                    if (currentValue !== originalValue) {
                        attrs[attrName] = currentValue;
                    }
                }
                addAttributeIfChanged('title', 'input.issue-title');
                addAttributeIfChanged('description', 'input.issue-description');
                addAttributeIfChanged('status', 'select.issue-status');
                addAttributeIfChanged('owner', 'select.issue-owner');
                addAttributeIfChanged('answer', 'input.issue-answer');
                addAttributeIfChanged('ng_issue_type_id', 'select.issue-type');
                addAttributeIfChanged('ng_issue_subtype_id', 'select.issue-subtype');
                this.issueClient.updateIssue(issueId, attrs)
                    .then(function (issue) {
                        $target.closest('button').attr('disabled', true);
                        // If no other buttons are enabled, disable the "update all" button as well
                        if ($('#issues-table button.update-issue:enabled').length === 0) {
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
            <select class="custom-select custom-select-sm issue-type" data-original-value="${issueTypeId}">
                ${this.issueTypes.map(issueType => `<option value="${issueType.id}" ${(issueType.id === issueTypeId) ? 'selected' : ''}>${issueType.title}</option>`).join('\n')}
            </select>
        `;

        const generateIssueSubtypeSelect = (issueTypeId, issueSubtypeId) => {
            const issueType = this.issueTypes.find(it => it.id === issueTypeId);
            const issueSubtypes = issueType ? issueType.subtypes : [];
            return `
                <select class="custom-select custom-select-sm issue-subtype" data-original-value="${issueSubtypeId}">
                    ${issueSubtypes.map(issueSubtype => `<option value="${issueSubtype.id}" ${(issueSubtype.id === issueSubtypeId) ? 'selected' : ''}>${issueSubtype.title}</option>`).join('\n')}
                </select>
            `;
        };

        const generateOwnerSelect = (ownerId) => `
            <select class="custom-select custom-select-sm issue-owner" data-original-value="${ownerId}">
                ${this.users.map(user => `<option value="${user.uid}" ${(user.uid === ownerId) ? 'selected' : ''}>${user.name}</option>`).join('\n')}
            </select>
        `;

        const generateLocationSelect = (locationId) => `
            <select class="custom-select custom-select-sm issue-location" data-original-value="${locationId}">
                <option value=""></option>
                ${this.locations.map(location => {
                    let name = location.name;
                    let parentId = location.parentId;
                    while (parentId) {
                        const parent = this.locations.find(l => l.id === parentId);
                        name = parent.name + ' > ' + name;
                        parentId = parent.parentId;
                    }
                    return `<option value="${location.id}" ${(location.id === locationId) ? 'selected' : ''}>${name}</option>`;
                }).join('\n')}
            </select>
        `;

        const generateStatusSelect = (status) => `
            <select class="custom-select custom-select-sm issue-status" data-original-value="${status}">
                ${['draft', 'open', 'closed'].map(_status => `<option value="${_status}" ${(_status === status) ? 'selected' : ''}>${_status}</option>`).join('\n')}
            </select>
        `;

        $('#pagination li.page-item.disabled span').text(`Issues ${this.page * this.pageSize + 1}-${(this.page + 1) * this.pageSize}`);

        // Update the table
        for (const issue of issues) {
            $tbody.append(`
                <tr>
                    <td class="center">
                        ${issue.identifier}
                    </td>
                    <td>
                        ${generateIssueTypeSelect(issue.ng_issue_type_id)}
                    </td>
                    <td>
                        ${generateIssueSubtypeSelect(issue.ng_issue_type_id, issue.ng_issue_subtype_id)}
                    </td>
                    <td>
                        <input type="text" class="form-control form-control-sm issue-title" data-original-value="${issue.title}" value="${issue.title}">
                    </td>
                    <td>
                        <input type="text" class="form-control form-control-sm issue-description" data-original-value="${issue.description}" value="${issue.description}">
                    </td>
                    <td>
                        ${generateOwnerSelect(issue.owner)}
                    </td>
                    <td>
                        ${generateLocationSelect(issue.lbs_location)}
                    </td>
                    <td>
                        ${generateStatusSelect(issue.status)}
                    </td>
                    <td>
                        <input type="text" class="form-control form-control-sm issue-answer" data-original-value="${issue.answer}" value="${issue.answer}">
                    </td>
                    <td class="center">
                        ${
                            issue.comment_count
                            ? `<button type="button" class="btn btn-outline-info btn-sm issue-comments" data-issue-id="${issue.id}" data-toggle="popover" title="Comments" data-content="Loading...">${issue.comment_count}</button>`
                            : '0'
                        }
                    </td>
                    <td class="center">
                        ${
                            issue.attachment_count
                            ? `<button type="button" class="btn btn-outline-info btn-sm issue-attachments" data-issue-id="${issue.id}" data-toggle="popover" title="Attachments" data-content="Loading...">${issue.attachment_count}</button>`
                            : '0'
                        }
                    </td>
                    <td>
                        <button type="button" data-issue-id="${issue.id}" class="btn btn-sm btn-success update-issue" disabled>
                            <i data-issue-id="${issue.id}" class="fas fa-cloud-upload-alt update-issue"></i>
                        </button>
                    </td>
                </tr>
            `);
        }

        // Enable comments/attachments popovers where needed
        const issueClient = this.issueClient;
        $tbody.find('button.issue-comments').each(async function () {
            const $this = $(this);
            const issueId = $this.data('issue-id');
            try {
                const comments = await issueClient.listIssueComments(issueId);
                const html = `
                    <ul>
                        ${comments.map(comment => `<li>[${new Date(comment.created_at).toLocaleString()}] ${comment.body}</li>`).join('\n')}
                    </ul>
                `;
                $this.attr('data-content', html);
            } catch(err) {
                $this.attr('data-content', `Could not load comments: ${err}`);
            } finally {
                $this.popover({ html: true, trigger: 'manual' })
                    .on('mouseenter', function () {
                        const _this = this;
                        $(this).popover('show');
                        $('.popover').on('mouseleave', function () { $(_this).popover('hide'); });
                    }).on('mouseleave', function () {
                        const _this = this;
                        setTimeout(function () {
                            if (!$('.popover:hover').length) { $(_this).popover('hide'); }
                        }, 300);
                    });
            }
        });
        const issueContainerId = this.issueClient.issueContainerId;
        $tbody.find('button.issue-attachments').each(async function () {
            const $this = $(this);
            const issueId = $this.data('issue-id');
            try {
                const attachments = await issueClient.listIssueAttachments(issueId);
                const html = `
                    <ul>
                        ${attachments.map(attachment => `
                            <li>
                                [${new Date(attachment.created_at).toLocaleString()}]
                                <a target="_blank" href="/api/issues/${issueContainerId}/${issueId}/attachments/${attachment.id}">
                                    <div>${attachment.name}</div>
                                    ${
                                        (attachment.name.toLowerCase().endsWith('.png') || attachment.name.toLowerCase().endsWith('.jpg') || attachment.name.toLowerCase().endsWith('.jpeg'))
                                            ? `<img alt="Loading..." src="/api/issues/${issueContainerId}/${issueId}/attachments/${attachment.id}" width="64">`
                                            : ''
                                    }
                                </a>
                            </li>
                        `).join('\n')}
                    </ul>
                `;
                $this.attr('data-content', html);
            } catch(err) {
                $this.attr('data-content', `Could not load attachments: ${err}`);
            } finally {
                $this.popover({ html: true, trigger: 'manual' })
                    .on('mouseenter', function () {
                        const _this = this;
                        $(this).popover('show');
                        $('.popover').on('mouseleave', function () { $(_this).popover('hide'); });
                    }).on('mouseleave', function () {
                        const _this = this;
                        setTimeout(function () {
                            if (!$('.popover:hover').length) { $(_this).popover('hide'); }
                        }, 300);
                    });
            }
        });
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
    constructor(issueContainerId, region) {
        this.issueContainerId = issueContainerId;
        this.region = region;
    }

    async _get(endpoint, params = {}) {
        const url = new URL(`/api/issues/${this.issueContainerId}` + endpoint, window.location.origin);
        url.searchParams.append('region', this.region);
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
        url.searchParams.append('region', this.region);
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
    constructor(accountId, region) {
        this.accountId = accountId;
        this.region = region;
    }

    async _get(endpoint, params = {}) {
        const url = new URL(`/api/account/${this.accountId}` + endpoint, window.location.origin);
        url.searchParams.append('region', this.region);
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
        url.searchParams.append('region', this.region);
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

class LocationClient {
    constructor(issueContainerId, region) {
        this.issueContainerId = issueContainerId;
        this.region = region;
    }

    async _get(endpoint = '', params = {}) {
        const url = new URL(`/api/locations/${this.issueContainerId}` + endpoint, window.location.origin);
        url.searchParams.append('region', this.region);
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

    async listLocations() {
        // Download the locations in batch to prevent server timeout
        const PageSize = 256
        let offset = 0;
        let results = [];
        let locations = await this._get('', { offset, limit: PageSize })
        while (locations.length > 0) {
            results = results.concat(locations);
            offset += PageSize;
            locations = await this._get('', { offset, limit: PageSize })
        }
        return results;
    }
}

class DocsClient {
    constructor(projectId, region) {
        this.projectId = projectId;
        this.region = region;
    }

    async _get(endpoint = '', params = {}) {
        const url = new URL(`/api/docs/${this.projectId}` + endpoint, window.location.origin);
        url.searchParams.append('region', this.region);
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

    async getItemDetails(itemId) {
        const details = await this._get(`/${itemId}`);
        return details;
    }
}
