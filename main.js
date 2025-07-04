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

function setupToggleDetailsButtons() {
    document.querySelectorAll('.toggle-details').forEach(button => {
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            const nodeDetails = this.nextElementSibling;
            nodeDetails.classList.toggle('hidden');

            if (nodeDetails.classList.contains('hidden')) {
                this.innerHTML = '<i class="fas fa-chevron-down"></i> Show failure details';
            } else {
                this.innerHTML = '<i class="fas fa-chevron-up"></i> Hide failure details';
            }
        });
    });
}

function getTabColor(tab) {
    const colors = {
        'violations': 'text-red-600 border-red-500',
        'incomplete': 'text-blue-600 border-blue-500',
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
                t.classList.remove('active', 'text-red-600', 'text-orange-500', 'text-blue-600', 'text-green-500');
                t.classList.remove('border-red-500', 'border-orange-500', 'border-blue-500', 'border-green-500');
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
                t.classList.remove('active', 'text-red-600', 'text-orange-500', 'text-blue-600', 'text-green-500');
                t.classList.remove('border-red-500', 'border-orange-500', 'border-blue-500', 'border-green-500');
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

        console.log(rows)
        console.log(totalPages)

        rows.forEach((row, index) => {
            row.style.display =
                index >= (currentPageTable - 1) * rowsPerPage && index < currentPageTable * rowsPerPage
                    ? ''
                    : 'none';
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

function applyFilters(impactFilter, tagFilter, disabilityFilter) {
    if (!impactFilter || !tagFilter || !disabilityFilter) return;

    const impactValue = impactFilter.value.toLowerCase();
    const tagValue = tagFilter.value.toLowerCase();
    const disabilityValue = disabilityFilter.value.toLowerCase();

    // First check if any filters are active
    const isFiltering = impactValue || tagValue || disabilityValue;

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

        // Impact filtering
        if (impactValue) {
            const impactEl = card.querySelector(`.bg-red-600, .bg-orange-500, .bg-blue-600, .bg-green-500`);
            if (!impactEl || !impactEl.textContent.toLowerCase().includes(impactValue)) {
                showCard = false;
            }
        }

        // Tag filtering
        if (tagValue && showCard) {
            const tagElements = card.querySelectorAll(".tag_list span");
            let hasTag = false;
            tagElements.forEach(tag => {
                if (tag.textContent.toLowerCase().includes(tagValue)) {
                    hasTag = true;
                }
            });
            if (!hasTag) showCard = false;
        }

        // Disability filtering
        if (disabilityValue && showCard) {
            const disabilityElements = card.querySelectorAll(".disability_list span");
            let hasDisability = false;
            disabilityElements.forEach(disability => {
                if (disability.textContent.toLowerCase().includes(disabilityValue)) {
                    hasDisability = true;
                }
            });
            if (!hasDisability) showCard = false;
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

function showReport(filePath) {
    window.location.href = `./pages/${filePath}.html`;


    // Automatically activate the 'incomplete' tab on page load
    const violationsTab = document.querySelector('[data-tab="violations"]');
    violationsTab.click();

    // Reattach event listeners if necessary
    const impactFilter = document.getElementById("impact-filter");
    const tagFilter = document.getElementById("tag-filter");
    const disabilityFilter = document.getElementById("disability-filter");

    if (impactFilter) impactFilter.addEventListener("change", () => applyFilters(impactFilter, tagFilter, disabilityFilter));
    if (tagFilter) tagFilter.addEventListener("change", () => applyFilters(impactFilter, tagFilter, disabilityFilter));
    if (disabilityFilter) disabilityFilter.addEventListener("change", () => applyFilters(impactFilter, tagFilter, disabilityFilter));

    // Apply filters to the loaded content
    applyFilters(impactFilter, tagFilter, disabilityFilter);
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`${tabId}-content`).classList.add('active');
    document.querySelector(`.tab[onclick="switchTab('${tabId}')"]`).classList.add('active');
}