tailwind.config = {
    theme: {
        extend: {}
    }
}



function copyToClipboard(text) {
    if (!navigator.clipboard) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            console.error('Fallback: Copy failed', err);
        }
        document.body.removeChild(textarea);
    } else {
        navigator.clipboard.writeText(text).catch(err => {
            console.error('Clipboard API copy failed', err);
        });
    }
}

function getTabColor(tab) {
    const colors = {
        'violations': 'text-red-600 border-red-500',
        'incomplete': 'text-yellow-800 border-yellow-800',
        'inapplicable': 'text-orange-500 border-orange-500',
        'passes': 'text-green-500 border-green-500'
    };
    return colors[tab] || '';
}

function setupTabs() {
    const tabs = document.querySelectorAll('[data-tab]');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabValue = tab.getAttribute('data-tab');
            console.log('Switching to tab:', tabValue);

            // Update active tab styling
            tabs.forEach(t => {
                t.classList.remove('active', 'text-red-600', 'text-orange-500', 'text-yellow-800', 'text-green-500');
                t.classList.remove('border-red-500', 'border-orange-500', 'border-yellow-800', 'border-green-500');
            });

            // Set active class for styling
            tab.classList.add('active');

            // Add color classes
            const colorClasses = getTabColor(tabValue).split(' ');
            tab.classList.add(...colorClasses);

            // IMPORTANT: Force-hide all tab contents first
            document.querySelectorAll('[data-tab-content]').forEach(content => {
                content.classList.add('hidden');
            });

            // Then show only the matching tab content
            const activeContent = document.querySelector(`[data-tab-content="${tabValue}"]`);
            if (activeContent) {
                activeContent.classList.remove('hidden');
                console.log('Showing content for:', tabValue);
            } else {
                console.error('No content found for tab:', tabValue);
            }

            // Update select-all checkbox states after tab switch
            updateSelectAllCheckboxStates();

            // Update the badge count after tab switch
            updateBugReportButtonBadge();
        });
    });
}

function toggleIssueCard(element) {
    const details = element.nextElementSibling;
    const chevron = element.querySelector(".chevron-icon");

    if (details.classList.contains("hidden")) {
        details.classList.remove("hidden");
        chevron.innerHTML = '<path d="m18 15-6-6-6 6"/>'; // Change to down chevron
    } else {
        details.classList.add("hidden");
        chevron.innerHTML = '<path d="m9 18 6-6-6-6"/>'; // Change to right chevron
    }
}

// JavaScript to handle tab and node interactions
document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('[data-tab]');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabValue = tab.getAttribute('data-tab');
            console.log('Switching to tab:', tabValue);

            // Update active tab styling
            tabs.forEach(t => {
                t.classList.remove('active', 'text-red-600', 'text-orange-500', 'text-yellow-800', 'text-green-500');
                t.classList.remove('border-red-500', 'border-orange-500', 'border-yellow-800', 'border-green-500');
            });

            // Set active class for styling
            tab.classList.add('active');

            // Add color classes
            const colorClasses = getTabColor(tabValue).split(' ');
            tab.classList.add(...colorClasses);

            // Hide all tab contents
            document.querySelectorAll('[data-tab-content]').forEach(content => {
                content.classList.add('hidden');
            });

            // Show the matching tab content
            const activeContent = document.querySelector(`[data-tab-content="${tabValue}"]`);
            if (activeContent) {
                activeContent.classList.remove('hidden');
                console.log('Showing content for:', tabValue);
            } else {
                console.error('No content found for tab:', tabValue);
            }

            // Apply pagination to the newly activated tab
            paginateIssues(tabValue);
        });
    });

    const rowsPerPage = 10;
    let currentPageTable = 1;

    function paginateTable() {
        const tableBody = document.getElementById('table-body');
        const rows = tableBody.querySelectorAll('tr');
        const totalPages = Math.ceil(rows.length / rowsPerPage);

        rows.forEach((row, index) => {
            row.style.display =
                index >= (currentPageTable - 1) * rowsPerPage && index < currentPageTable * rowsPerPage ?
                '' :
                'none';
        });

        const controls = document.getElementById('pagination-controls');
        controls.innerHTML = '';

        for (let i = 1; i <= totalPages; i++) {
            const btn = document.createElement('button');
            btn.innerText = i;
            if (i === currentPageTable) btn.disabled = true;
            btn.addEventListener('click', () => {
                currentPageTable = i;
                paginateTable();
            });
            controls.appendChild(btn);
        }
    }

    window.onload = paginateTable;
});

// Initialize Select2 for multi-select filters
function initializeSelect2() {
    if (typeof $ !== 'undefined' && $.fn.select2) {
        $('.select2-filter').select2({
            placeholder: function() {
                return $(this).data('placeholder');
            },
            allowClear: true,
            width: '100%'
        });
    }
}

function applyFilters(impactFilter, tagFilter, disabilityFilter) {
    if (!impactFilter || !tagFilter || !disabilityFilter) return;

    // Get selected values from Select2 (multiple selections)
    const impactValues = $(impactFilter).val() || [];
    const tagValues = $(tagFilter).val() || [];
    const disabilityValues = $(disabilityFilter).val() || [];

    // Check if any filters are active
    const isFiltering = impactValues.length > 0 || tagValues.length > 0 || disabilityValues.length > 0;

    // Track visible counts for each tab
    const visibleCounts = {
        'violations': 0,
        'incomplete': 0,
        'inapplicable': 0,
        'passes': 0
    };

    // Filter logic
    document.querySelectorAll(".issue-card").forEach(card => {
        const tabContent = card.closest('[data-tab-content]');
        const tabName = tabContent ? tabContent.getAttribute('data-tab-content') : null;
        if (!tabName) return;

        let showCard = true;

        // Impact filtering - check if any selected impact matches
        if (impactValues.length > 0) {
            const impactEl = card.querySelector(`.issue-impact`);
            if (!impactEl) {
                showCard = false;
            } else {
                const cardImpact = impactEl.textContent.toLowerCase();
                const hasMatchingImpact = impactValues.some(selectedImpact =>
                    cardImpact.includes(selectedImpact.toLowerCase())
                );
                if (!hasMatchingImpact) {
                    showCard = false;
                }
            }
        }

        // Tag filtering - check if any selected tag matches
        if (tagValues.length > 0 && showCard) {
            const tagElements = card.querySelectorAll(".tag_list span");
            let hasMatchingTag = false;
            tagElements.forEach(tag => {
                const tagText = tag.textContent.toLowerCase();
                if (tagValues.some(selectedTag => tagText.includes(selectedTag.toLowerCase()))) {
                    hasMatchingTag = true;
                }
            });
            if (!hasMatchingTag) showCard = false;
        }

        // Disability filtering - check if any selected disability matches
        if (disabilityValues.length > 0 && showCard) {
            const disabilityElements = card.querySelectorAll(".disability_list span");
            let hasMatchingDisability = false;
            disabilityElements.forEach(disability => {
                const disabilityText = disability.textContent.toLowerCase();
                if (disabilityValues.some(selectedDisability =>
                        disabilityText.includes(selectedDisability.toLowerCase())
                    )) {
                    hasMatchingDisability = true;
                }
            });
            if (!hasMatchingDisability) showCard = false;
        }

        card.style.display = showCard ? "" : "none";

        // Count visible items by tab
        if (showCard) {
            visibleCounts[tabName]++;
        }
    });

    // Update issue counts and show/hide "no results" messages for each tab
    Object.keys(visibleCounts).forEach(tabId => {
        const tabHeader = document.querySelector(`[data-tab="${tabId}"]`);
        const tabContent = document.querySelector(`[data-tab-content="${tabId}"]`);

        if (tabHeader) {
            const countElement = tabHeader.querySelector('.issue-count');
            if (countElement) {
                countElement.textContent = visibleCounts[tabId];
            }
        }

        if (tabContent) {
            const noResultsMessage = tabContent.querySelector('.no-results-message');
            if (visibleCounts[tabId] === 0) {
                noResultsMessage.classList.remove('hidden');
            } else {
                noResultsMessage.classList.add('hidden');
            }
        }
    });

    // Update select-all checkbox states based on no-results messages
    updateSelectAllCheckboxStates();

    // Update the badge count after filtering
    updateBugReportButtonBadge();
}

// Add pagination function
function paginateIssues(tab) {
    const issues = document.querySelectorAll(`[data-tab-content="${tab}"] .issue-card:not(.filtered)`);
    const totalIssues = issues.length;
    const totalPages = Math.ceil(totalIssues / ITEMS_PER_PAGE);

    // Update pagination UI
    updatePaginationUI(tab, currentPage[tab], totalPages, totalIssues);

    // Show only issues for current page
    issues.forEach((issue, index) => {
        const startIndex = (currentPage[tab] - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE - 1;

        if (index >= startIndex && index <= endIndex) {
            issue.classList.remove('pagination-hidden');
        } else {
            issue.classList.add('pagination-hidden');
        }
    });
}

// Function to update pagination UI
function updatePaginationUI(tab, currentPage, totalPages, totalIssues) {
    const paginationContainer = document.querySelector(`[data-tab-content="${tab}"] .pagination`);
    if (!paginationContainer) return;

    const numbersContainer = paginationContainer.querySelector('.pagination-numbers');
    const prevButton = paginationContainer.querySelector('.pagination-prev');
    const nextButton = paginationContainer.querySelector('.pagination-next');

    // Update range text
    const startItem = totalIssues > 0 ? Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, totalIssues) : 0;
    const endItem = Math.min(currentPage * ITEMS_PER_PAGE, totalIssues);
    paginationContainer.querySelector('.current-range').textContent = `${startItem}-${endItem}`;
    paginationContainer.querySelector('.total-items').textContent = totalIssues;

    // Disable/enable prev/next buttons
    prevButton.disabled = currentPage === 1;
    nextButton.disabled = currentPage === totalPages || totalPages === 0;

    // Generate page numbers
    numbersContainer.innerHTML = '';

    // Determine range of pages to show
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);

    // Adjust start if we're near the end
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    // Create page buttons
    for (let i = startPage; i <= endPage; i++) {
        const pageButton = document.createElement('button');
        pageButton.classList.add('page-number', 'px-3', 'py-1', 'rounded');

        if (i === currentPage) {
            pageButton.classList.add('bg-blue-600', 'text-white');
        } else {
            pageButton.classList.add('border');
        }

        pageButton.textContent = i;
        pageButton.dataset.page = i;
        pageButton.dataset.tab = tab;

        numbersContainer.appendChild(pageButton);
    }
}

// Add CSS for pagination hiding
const style = document.createElement('style');
style.textContent = `.pagination-hidden { display: none !important; }`;
document.head.appendChild(style);

document.addEventListener('click', (e) => {
    // Previous button
    if (e.target.classList.contains('pagination-prev')) {
        const tab = document.querySelector('[data-tab].active').getAttribute('data-tab');
        if (currentPage[tab] > 1) {
            currentPage[tab]--;
            paginateIssues(tab);
        }
    }

    // Next button
    if (e.target.classList.contains('pagination-next')) {
        const tab = document.querySelector('[data-tab].active').getAttribute('data-tab');
        const issues = document.querySelectorAll(`[data-tab-content="${tab}"] .issue-card:not(.filtered)`);
        const totalPages = Math.ceil(issues.length / ITEMS_PER_PAGE);

        if (currentPage[tab] < totalPages) {
            currentPage[tab]++;
            paginateIssues(tab);
        }
    }

    // Page number buttons
    if (e.target.classList.contains('page-number')) {
        const page = parseInt(e.target.dataset.page);
        const tab = e.target.dataset.tab;
        currentPage[tab] = page;
        paginateIssues(tab);
    }
});

function showDashboard() {
    document.getElementById('report-page').classList.remove('active');
    document.getElementById('report-page').classList.add('hidden');

    document.getElementById('dashboard').classList.add('active');
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('dashboard').style.display = 'block';

    // Hide breadcrumb container
    document.getElementById('breadcrumb-container').style.display = 'none';
}

// function showReport(filePath) {
//     window.location.href = `./pages/${filePath}.html`;
//
//     // Automatically activate the 'violations' tab on page load
//     const violationsTab = document.querySelector('[data-tab="violations"]');
//     violationsTab.click();
//
//     // Initialize Select2 after DOM is loaded
//     $(document).ready(function() {
//         initializeSelect2();
//
//         // Get filter elements
//         const impactFilter = document.getElementById("impact-filter");
//         const tagFilter = document.getElementById("tag-filter");
//         const disabilityFilter = document.getElementById("disability-filter");
//
//         // Add Select2 change event listeners
//         if (impactFilter) {
//             $(impactFilter).on('change', () => applyFilters(impactFilter, tagFilter, disabilityFilter));
//         }
//         if (tagFilter) {
//             $(tagFilter).on('change', () => applyFilters(impactFilter, tagFilter, disabilityFilter));
//         }
//         if (disabilityFilter) {
//             $(disabilityFilter).on('change', () => applyFilters(impactFilter, tagFilter, disabilityFilter));
//         }
//
//         // Apply filters to the loaded content
//         applyFilters(impactFilter, tagFilter, disabilityFilter);
//     });
// }

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`${tabId}-content`).classList.add('active');
    document.querySelector(`.tab[onclick="switchTab('${tabId}')"]`).classList.add('active');
}

// Initialize everything when DOM is ready
$(document).ready(function() {
    // Initialize Select2
    initializeSelect2();

    // Set up filter event listeners
    const impactFilter = document.getElementById("impact-filter");
    const tagFilter = document.getElementById("tag-filter");
    const disabilityFilter = document.getElementById("disability-filter");

    if (impactFilter) {
        $(impactFilter).on('change', () => applyFilters(impactFilter, tagFilter, disabilityFilter));
    }
    if (tagFilter) {
        $(tagFilter).on('change', () => applyFilters(impactFilter, tagFilter, disabilityFilter));
    }
    if (disabilityFilter) {
        $(disabilityFilter).on('change', () => applyFilters(impactFilter, tagFilter, disabilityFilter));
    }

    // Set up select-all checkboxes for violations and incomplete tabs
    ['violations', 'incomplete'].forEach(tabName => {
        const selectAllCheckbox = document.getElementById('select-all-checkbox-' + tabName);
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', function() {
                const checked = this.checked;
                const tabContent = document.querySelector('[data-tab-content="' + tabName + '"]');
                if (tabContent && !tabContent.classList.contains('hidden')) {
                    // Only select/deselect visible checkboxes
                    tabContent.querySelectorAll('input[type="checkbox"][id^="issue-"]').forEach(cb => {
                        const issueCard = cb.closest('.issue-card');
                        if (issueCard && issueCard.style.display !== 'none') {
                            cb.checked = checked;
                        }
                    });
                }
            });
        }
    });

    // Initial update of select-all checkbox states
    updateSelectAllCheckboxStates();

    // Initial update of badge count
    updateBugReportButtonBadge();
});

// --- DASHBOARD TABLE SEARCH ---
$(document).ready(function() {
    const dashboardSearchInput = document.getElementById('dashboard-search-input');
    const dashboardSearchButton = document.getElementById('dashboard-search-button');
    const filterPriority = document.getElementById('filter-priority');
    const filterViewport = document.getElementById('filter-viewport');

    if (dashboardSearchInput) {
        dashboardSearchInput.addEventListener('input', performSearch);
    }

    if (dashboardSearchButton) {
        dashboardSearchButton.addEventListener('click', performSearch);
    }

    if (filterPriority) {
        filterPriority.addEventListener('change', performSearch);
    }

    if (filterViewport) {
        filterViewport.addEventListener('change', performSearch);
    }
});

// Enhanced search and filter functionality
function performSearch() {
    const searchInput = document.getElementById('dashboard-search-input');
    const filterSelect = document.getElementById('filter-priority');
    const viewportSelect = document.getElementById('filter-viewport');
    const searchValue = (searchInput && searchInput.value) ? searchInput.value.toLowerCase() : '';
    const filterValue = (filterSelect && filterSelect.value) ? filterSelect.value : 'all';
    const viewportValue = (viewportSelect && viewportSelect.value) ? viewportSelect.value : 'all';
    const rows = document.querySelectorAll('#sortable-table tbody tr');
    const tableBody = document.getElementById('table-body');

    let visibleCount = 0;

    rows.forEach(row => {
        const pageLink = row.querySelector('.url-cell a');
        const pageUrl = pageLink ? pageLink.textContent.toLowerCase() : '';
        const matchesSearch = searchValue === '' || pageUrl.includes(searchValue);

        const rowViewport = row.getAttribute('data-viewport') || 'desktop';
        const matchesViewport = viewportValue === 'all' || rowViewport === viewportValue;

        let matchesFilter = true;
        if (filterValue === 'critical') {
            const criticalCell = row.querySelector('.status-cell.critical_elements');
            const criticalCount = criticalCell ? parseInt(criticalCell.textContent) || 0 : 0;
            matchesFilter = criticalCount > 0;
        } else if (filterValue === 'serious') {
            const seriousCell = row.querySelector('.status-cell.serious_elements');
            const seriousCount = seriousCell ? parseInt(seriousCell.textContent) || 0 : 0;
            matchesFilter = seriousCount > 0;
        } else if (filterValue === 'moderate') {
            const moderateCell = row.querySelector('.status-cell.moderate_elements');
            const moderateCount = moderateCell ? parseInt(moderateCell.textContent) || 0 : 0;
            matchesFilter = moderateCount > 0;
        } else if (filterValue === 'minor') {
            const minorCell = row.querySelector('.status-cell.minor_elements');
            const minorCount = minorCell ? parseInt(minorCell.textContent) || 0 : 0;
            matchesFilter = minorCount > 0;
        } else if (filterValue === 'violation') {
            const violationBadge = row.querySelector('.violation-badge.violations');
            const violationCount = violationBadge ? parseInt(violationBadge.textContent) || 0 : 0;
            matchesFilter = violationCount > 0;
        } else if (filterValue === 'incomplete') {
            const incompleteBadge = row.querySelector('.violation-badge.incomplete');
            const incompleteCount = incompleteBadge ? parseInt(incompleteBadge.textContent) || 0 : 0;
            matchesFilter = incompleteCount > 0;
        }

        if (matchesSearch && matchesFilter && matchesViewport) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    // Show/hide no results message
    let noResultsRow = tableBody.querySelector('.no-results-row');
    if (visibleCount === 0) {
        if (!noResultsRow) {
            noResultsRow = document.createElement('tr');
            noResultsRow.className = 'no-results-row';
            noResultsRow.innerHTML = `
                <td colspan="6" class="no-results-message">
                    <div class="text-center py-8">
                        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.47-.881-6.08-2.33" />
                        </svg>
                        <h3 class="mt-2 text-sm font-medium text-gray-900">No pages found</h3>
                        <p class="mt-1 text-sm text-gray-500">
                            ${searchValue ? `No pages match "${searchValue}"` : ''}
                            ${filterValue !== 'all' ? `No pages have ${filterValue} issues` : ''}
                            ${searchValue && filterValue !== 'all' ? ' with the current criteria' : ''}
                        </p>
                        <div>
                            <button type="button" onclick="clearSearchAndFilters()" class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                                Clear filters
                            </button>
                        </div>
                    </div>
                </td>
            `;
            tableBody.appendChild(noResultsRow);
        }
        noResultsRow.style.display = '';
        const paginationControls = document.getElementById('pagination-controls');
        if (paginationControls) {
            paginationControls.style.display = 'none';
        }
    } else {
        if (noResultsRow) {
            noResultsRow.style.display = 'none';
            const paginationControls = document.getElementById('pagination-controls');
            if (paginationControls) {
                paginationControls.style.display = '';
            }
        }
    }
}

// Function to clear search and filters
function clearSearchAndFilters() {
    const searchInput = document.getElementById('dashboard-search-input');
    const filterSelect = document.getElementById('filter-priority');
    const viewportSelect = document.getElementById('filter-viewport');

    if (searchInput) {
        searchInput.value = '';
    }
    if (filterSelect) {
        filterSelect.value = 'all';
    }
    if (viewportSelect) {
        viewportSelect.value = 'all';
    }

    const paginationControls = document.getElementById('pagination-controls');
    if (paginationControls) {
        paginationControls.style.display = '';
    }

    
    performSearch();
}

// Enhanced table sorting functionality
function sortTable(sortBy, direction) {
    const tableBody = document.getElementById('table-body');
    const rows = Array.from(tableBody.querySelectorAll('tr'));

    const sortedRows = rows.sort((rowA, rowB) => {
        let valueA, valueB;

        switch (sortBy) {
            case 'pagePath':
                const linkA = rowA.querySelector('.url-cell a');
                const linkB = rowB.querySelector('.url-cell a');
                valueA = linkA ? linkA.textContent.toLowerCase() : '';
                valueB = linkB ? linkB.textContent.toLowerCase() : '';
                break;
            case 'critical_elements':
                const criticalA = rowA.querySelector('.status-cell.critical_elements');
                const criticalB = rowB.querySelector('.status-cell.critical_elements');
                valueA = criticalA ? parseInt(criticalA.textContent) || 0 : 0;
                valueB = criticalB ? parseInt(criticalB.textContent) || 0 : 0;
                break;
            case 'serious_elements':
                const seriousA = rowA.querySelector('.status-cell.serious_elements');
                const seriousB = rowB.querySelector('.status-cell.serious_elements');
                valueA = seriousA ? parseInt(seriousA.textContent) || 0 : 0;
                valueB = seriousB ? parseInt(seriousB.textContent) || 0 : 0;
                break;
            case 'moderate_elements':
                const moderateA = rowA.querySelector('.status-cell.moderate_elements');
                const moderateB = rowB.querySelector('.status-cell.moderate_elements');
                valueA = moderateA ? parseInt(moderateA.textContent) || 0 : 0;
                valueB = moderateB ? parseInt(moderateB.textContent) || 0 : 0;
                break;
            case 'minor_elements':
                const minorA = rowA.querySelector('.status-cell.minor_elements');
                const minorB = rowB.querySelector('.status-cell.minor_elements');
                valueA = minorA ? parseInt(minorA.textContent) || 0 : 0;
                valueB = minorB ? parseInt(minorB.textContent) || 0 : 0;
                break;
            case 'violations':
                const violationBadgeA = rowA.querySelector('.violation-badge.violations');
                const violationBadgeB = rowB.querySelector('.violation-badge.violations');
                valueA = violationBadgeA ? parseInt(violationBadgeA.textContent) || 0 : 0;
                valueB = violationBadgeB ? parseInt(violationBadgeB.textContent) || 0 : 0;
                break;
            default:
                return 0;
        }

        if (sortBy === 'pagePath') {
            return direction === 'desc' ?
                valueB.localeCompare(valueA) :
                valueA.localeCompare(valueB);
        } else {
            return direction === 'desc' ? valueB - valueA : valueA - valueB;
        }
    });

    // Remove all existing rows
    while (tableBody.firstChild) {
        tableBody.removeChild(tableBody.firstChild);
    }

    // Add sorted rows
    sortedRows.forEach(row => {
        tableBody.appendChild(row);
    });
}

function updateSelectAllCheckboxState() {
    const noResults = document.querySelector('.no-results-message:not(.hidden)');
    const selectAll = document.getElementById('select-all-checkbox');
    if (selectAll) {
        selectAll.disabled = !!noResults;
    }
}

// Add this new function to update select-all checkbox states
function updateSelectAllCheckboxStates() {
    // Check violations tab
    const violationsTabContent = document.querySelector('[data-tab-content="violations"]');
    const violationsNoResults = violationsTabContent ? violationsTabContent.querySelector('.no-results-message:not(.hidden)') : null;
    const violationsSelectAll = document.getElementById('select-all-checkbox-violations');
    
    if (violationsSelectAll) {
        violationsSelectAll.disabled = !!violationsNoResults;
        if (violationsNoResults) {
            violationsSelectAll.checked = false;
        }
    }
    
    // Check incomplete tab
    const incompleteTabContent = document.querySelector('[data-tab-content="incomplete"]');
    const incompleteNoResults = incompleteTabContent ? incompleteTabContent.querySelector('.no-results-message:not(.hidden)') : null;
    const incompleteSelectAll = document.getElementById('select-all-checkbox-incomplete');
    
    if (incompleteSelectAll) {
        incompleteSelectAll.disabled = !!incompleteNoResults;
        if (incompleteNoResults) {
            incompleteSelectAll.checked = false;
        }
    }
}

// Add this new function to update the bug report button badge
function updateBugReportButtonBadge() {
    const bugBtn = document.getElementById('generateBugReportBtn');
    if (!bugBtn) return;
    
    const selectedCheckboxes = document.querySelectorAll('.issue-checkbox:checked');
    const count = selectedCheckboxes.length;
    
    // Remove existing badge if any
    const existingBadge = bugBtn.querySelector('.badge-count');
    if (existingBadge) {
        existingBadge.remove();
    }
    
    // Add new badge if there are selected items
    if (count > 0) {
        const badge = document.createElement('div');
        badge.className = 'badge-count absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold';
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.fontSize = '10px';
        badge.style.minWidth = '20px';
        badge.style.height = '20px';
        bugBtn.appendChild(badge);
    }
}

// Update the existing change event listener to include badge updates
document.addEventListener('change', function () {
    const anyChecked = document.querySelectorAll('input[type="checkbox"]:checked').length > 0;

    const bugBtn = document.getElementById('generateBugReportBtn');
    if (bugBtn) {
        bugBtn.disabled = !anyChecked;
        bugBtn.classList.toggle('bg-blue-600', anyChecked);
        bugBtn.classList.toggle('hover:bg-blue-700', anyChecked);
        bugBtn.classList.toggle('cursor-pointer', anyChecked);
        bugBtn.classList.toggle('bg-gray-300', !anyChecked);
        bugBtn.classList.toggle('cursor-not-allowed', !anyChecked);
    }
    
    // Update the badge count
    updateBugReportButtonBadge();
});