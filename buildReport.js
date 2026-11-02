#!/usr/bin/env node

const fs = require('fs');
const path = require("path");
const os = require("os");
const URL = require('url').URL;
require('dotenv').config({path: path.join(process.cwd(), '.env.a11y')});

const BASE_DIR = process.env.OUTPUT_DIR || './axe-playwright-report'
const PAGES_DIR = '/pages';
const MERGE_STRATEGY = process.env.MERGE_STRATEGY || 'best';
const DEFAULT_REPORT_CONCURRENCY = Math.max(1, Math.min(4, os.cpus().length || 1));
// Shipped assets (template, styles, data) live next to this file, or one level up when it runs from dist/.
const PACKAGE_ROOT = path.basename(__dirname) === 'dist' ? path.dirname(__dirname) : __dirname;

function getOutputPath(...segments) {
    const outputDir = path.isAbsolute(BASE_DIR) ? BASE_DIR : path.join(process.cwd(), BASE_DIR);
    return path.join(outputDir, ...segments);
}

function createEmptyImpactSummary() {
    return {
        "Violations": {
            "Critical": 0,
            "Serious": 0,
            "Moderate": 0,
            "Minor": 0
        },
        "Incomplete": {
            "Critical": 0,
            "Serious": 0,
            "Moderate": 0,
            "Minor": 0
        },
        "Passed": 0,
        "Inapplicable": 0
    };
}

// Removes only what main() writes, so other files in OUTPUT_DIR survive.
function cleanUp() {
    const outputDir = getOutputPath();
    const fromOutputToCwd = path.relative(outputDir, process.cwd());
    if (!fromOutputToCwd.startsWith('..') && !path.isAbsolute(fromOutputToCwd)) {
        throw new Error(`OUTPUT_DIR "${BASE_DIR}" is the working directory or contains it. Set it to a dedicated folder, e.g. OUTPUT_DIR=axe-playwright-report.`);
    }
    for (const entry of [PAGES_DIR, 'index.html', 'impactSummary.json', 'styles.css', 'main.js']) {
        fs.rmSync(getOutputPath(entry), {recursive: true, force: true});
    }
}

function getReportFiles() {
    let allFiles = [];
    const reportDir = getOutputPath(PAGES_DIR);

    try {
        allFiles = fs.readdirSync(reportDir);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return [];
        } else {
            throw err
        }
    }
    return allFiles.filter(file => file.endsWith('.json'));
}

function getAxeVersion(version) {
    const parts = version.split('.');
    return parts.slice(0, 2).join('.');
}

function escapeHTML(html) {
    return String(html ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function readJSONFile(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function pluralize(count, singular, plural = singular + 's') {
    return `${count} ${count === 1 ? singular : plural}`;
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getReportConcurrency() {
    return parsePositiveInteger(process.env.REPORT_CONCURRENCY, DEFAULT_REPORT_CONCURRENCY);
}

async function mapWithConcurrency(items, concurrency, mapper) {
    if (items.length === 0) return [];
    const limit = Math.max(1, Math.min(concurrency, items.length));
    const results = new Array(items.length);
    let nextIndex = 0;

    await Promise.all(Array.from({length: limit}, async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex++;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    }));

    return results;
}

// Build a ruleId -> rule lookup once, so callers can avoid O(n) `affected.find()`
// for every rule of every report.
function buildAffectedIndex(affected) {
    const index = new Map();
    if (Array.isArray(affected)) {
        for (const rule of affected) {
            if (rule && rule.ruleId) index.set(rule.ruleId, rule);
        }
    }
    return index;
}

function addImpactCount(bucket, impact, amount = 1) {
    if (impact === 'critical') bucket.Critical += amount;
    else if (impact === 'serious') bucket.Serious += amount;
    else if (impact === 'moderate') bucket.Moderate += amount;
    else if (impact === 'minor') bucket.Minor += amount;
}

function nodeCount(rule) {
    return Array.isArray(rule?.nodes) ? rule.nodes.length : 0;
}

function getIssues(report, section) {
    return Array.isArray(report?.[section]) ? report[section] : [];
}

function buildReportStats(reports, affectedIndex = null) {
    const impactSummary = createEmptyImpactSummary();
    const summary = {
        violationsRulesTotalCount: 0,
        violationElementsTotalCount: 0,
        incompleteRulesTotalCount: 0,
        incompleteElementsTotalCount: 0,
        passesRulesTotalCount: 0,
        passesElementsTotalCount: 0,
        totalRulesReports: 0,
        totalElementsReports: 0
    };
    const tableRows = [];
    const disabilityCounts = {};
    let disabilityIssueTotal = 0;

    for (const report of reports || []) {
        const violationsList = getIssues(report, 'violations');
        const incompleteList = getIssues(report, 'incomplete');
        const passesList = getIssues(report, 'passes');
        const inapplicableList = getIssues(report, 'inapplicable');

        summary.violationsRulesTotalCount += violationsList.length;
        summary.incompleteRulesTotalCount += incompleteList.length;
        summary.passesRulesTotalCount += passesList.length;

        let critical_elements = 0, serious_elements = 0, moderate_elements = 0, minor_elements = 0;
        let critical = 0, serious = 0, moderate = 0, none = 0;

        const tallyDashboardIssue = issue => {
            if (issue.impact === 'critical') critical++;
            else if (issue.impact === 'serious') serious++;
            else if (issue.impact === 'moderate') moderate++;
            else none++;

            for (const node of (issue.nodes || [])) {
                if (node.impact === 'critical') critical_elements++;
                else if (node.impact === 'serious') serious_elements++;
                else if (node.impact === 'moderate') moderate_elements++;
                else if (node.impact === 'minor') minor_elements++;
            }
        };

        for (const violation of violationsList) {
            summary.violationElementsTotalCount += nodeCount(violation);
            tallyDashboardIssue(violation);
            for (const node of (violation.nodes || [])) addImpactCount(impactSummary.Violations, node.impact);
        }

        for (const incomplete of incompleteList) {
            summary.incompleteElementsTotalCount += nodeCount(incomplete);
            tallyDashboardIssue(incomplete);
            for (const node of (incomplete.nodes || [])) addImpactCount(impactSummary.Incomplete, node.impact);
        }

        for (const pass of passesList) {
            const count = nodeCount(pass);
            summary.passesElementsTotalCount += count;
            impactSummary.Passed += count;
        }

        for (const item of inapplicableList) {
            impactSummary.Inapplicable += nodeCount(item);
        }

        if (affectedIndex) {
            for (const issue of [...violationsList, ...incompleteList, ...passesList]) {
                disabilityIssueTotal++;
                const rule = affectedIndex.get(issue.id);
                for (const disability of (rule?.disabilityTypesAffected || [])) {
                    if (!disability.name) continue;
                    disabilityCounts[disability.name] = (disabilityCounts[disability.name] || 0) + 1;
                }
            }
        } else {
            disabilityIssueTotal += violationsList.length + incompleteList.length + passesList.length;
        }

        tableRows.push({
            id: report.id,
            viewport: report.viewport,
            pagePath: report.pagePath || report.id,
            critical_elements,
            serious_elements,
            moderate_elements,
            minor_elements,
            violations: violationsList.length,
            incomplete: incompleteList.length,
            passes: passesList.length,
            inapplicable: inapplicableList.length,
            critical,
            serious,
            moderate,
            none,
            impactsSortKey: [critical_elements, serious_elements, moderate_elements, minor_elements, critical, serious, moderate, none],
        });
    }

    summary.totalRulesReports =
        summary.violationsRulesTotalCount +
        summary.incompleteRulesTotalCount +
        summary.passesRulesTotalCount;
    summary.totalElementsReports =
        summary.violationElementsTotalCount +
        summary.incompleteElementsTotalCount +
        summary.passesElementsTotalCount;

    return {
        summary,
        tableRows,
        impactSummary,
        impactDistribution: {
            Critical: impactSummary.Violations.Critical + impactSummary.Incomplete.Critical,
            Serious: impactSummary.Violations.Serious + impactSummary.Incomplete.Serious,
            Moderate: impactSummary.Violations.Moderate + impactSummary.Incomplete.Moderate,
            Minor: impactSummary.Violations.Minor + impactSummary.Incomplete.Minor
        },
        disabilityCounts,
        disabilityIssueTotal
    };
}

function generateBaseDashboard(template) {
    return template.replace("{{CONTENT}}",
        `<body>
            <header>
                <div class="container mx-auto flex justify-between">
                    <p class="header-text text-2xl font-bold text-gray-800">Accessibility Report Dashboard</p>
                    <p class="text-sm text-gray-500">Powered by axe-core</p>
                </div>
            </header>
            
    <nav>
        <div id="breadcrumb-container" style="display:none;">
              <!--<ul class="breadcrumb">
                <li><a href="#" onclick="showDashboard()">Dashboard</a></li>
                <li id="report-breadcrumb" style="display:none;">Report Details</li>
            </ul>-->
        </div>
    </nav>

    <main>
        <h1 class="visually-hidden">Dashboard Overview</h1>
        <div class="container mx-auto">
            <!-- Dashboard View -->
            <div class="dashboard active" id="dashboard">
                {{summary_cards}}
                <div class="chart-container grid grid-cols-2 gap-4">
                    {{impact_distribution_chart}}
                    {{disabilities_affected_chart}}
                </div>
                {{dashboard_search_bar}}
                {{table_cards}}
            </div>
        </div>
    </main>
    </body>
    `);
}

function generateBaseContent(template, report) {
    const {userAgent, windowWidth, windowHeight} = report.testEnvironment || {};

    return template.replace("{{CONTENT}}",
        `<body class="text-gray-900">
     <header>
         <div class="container mx-auto flex justify-between">
        <p class="text-2xl font-bold text-gray-800">Accessibility Report Dashboard</p>
        <p class="text-sm text-gray-500">Powered by axe-core</p>
        </div>
    </header>



 <main>
            <div class="container mx-auto">
            <nav>
        <div id="breadcrumb-container">
            <ul class="breadcrumb">
                <li><a href="../index.html" title="Dashboard">Dashboard</a></li>
                <li id="report-breadcrumb">${escapeHTML(report.pagePath !== undefined ? report.pagePath : report.url)}</li>
            </ul>
        </div>
    </nav>
                <!-- Header and Breadcrumb -->
                <div class="mb-2">
                   <div class="page-url flex justify-between items-center">
                        <h1 class="text-3xl font-bold">Page:  ${report.pagePath !== undefined ? report.pagePath : report.url}</h1>
                        <div class="flex items-center">
                        <a href="${report.url}" target="_blank" class="text-blue-600 hover:text-blue-800">
                            <button class="border border-blue-600 text-blue-600 px-4 py-2 rounded hover:bg-blue-100">
                              View in Browser
                            </button>
                        </a>
<button id="generateBugReportBtn"
        class="bug-report-btn ml-2 text-white px-4 py-2 rounded bg-gray-300 cursor-not-allowed relative"
        disabled=""
        title="Select one or more issues below, then generate a preformatted title and summary ready to paste into Jira or other tracking tools.">
  Generate Bug Summary
</button>
                    </div>
                   </div>
                    <div class="text-sm text-gray-500">
    <div>Browser: ${userAgent || 'N/A'}, Viewport: ${windowWidth || 0}×${windowHeight || 0}${report.viewport ? ` · Device: ${escapeHTML(report.viewport)}` : ''}</div>
</div>
                </div>


                {{FILTERS}}

                {{TABS}}

                {{ISSUE_CARDS}}
            </div>
        <!-- Modal Backdrop -->
     <div id="bugReportModal" class="fixed inset-0 bg-black bg-opacity-50 hidden z-50 flex items-center justify-center">
         <!-- Modal Content -->
         <div class="bg-white rounded-lg p-6 max-w-2xl w-full shadow-lg">
             <h2 class="text-xl font-bold mb-4">Bug Summary</h2>

           <div class="flex items-center mb-2">
            <strong>Title:</strong>
                <button id="copyBugTitleBtn" type="button" title="Copy to clipboard" class="ml-2 text-gray-500 hover:text-blue-600" style="background: none; border: none; cursor: pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                        <rect x="8" y="8" width="12" height="12" rx="2" ry="2"></rect>
                        <rect x="4" y="4" width="12" height="12" rx="2" ry="2"></rect>
                    </svg>
                </button>
            </div>
             <input id="bugTitle" class="mt-1 text-gray-800 w-full border rounded p-2 text-sm" type="text" placeholder="Bug Title">

            <div class="flex items-center mb-2">
                <strong>Description:</strong>
                <button id="copyBugSummaryBtn" type="button" title="Copy to clipboard" class="ml-2 text-gray-500 hover:text-blue-600" style="background: none; border: none; cursor: pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                        <rect x="8" y="8" width="12" height="12" rx="2" ry="2"></rect>
                        <rect x="4" y="4" width="12" height="12" rx="2" ry="2"></rect>
                    </svg>
                </button>
            </div>
            <textarea id="bugSummary" class="mt-1 text-gray-800 w-full border rounded p-2 text-sm" rows="20"></textarea>

             <div class="text-right">
                 <button id="closeBugModal" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                     Close
                 </button>
             </div>
         </div>
     </div>
    </main></body>
        `) + `
    <script>
        // The button's enabled state and badge are updated by main.js on 'change'.
        const bugBtn = document.getElementById('generateBugReportBtn');
        const modal = document.getElementById('bugReportModal');
        const closeBtn = document.getElementById('closeBugModal');

        bugBtn.addEventListener('click', () => {
            const bugTitle = document.getElementById('bugTitle');
            const summaryEl = document.getElementById('bugSummary');
            
            const pageElement = document.querySelector(".page-url")
            const pageTitle = pageElement.querySelector("h1").innerText.trim().split(" ")[1]
            const pageUrl = pageElement.querySelector("a").getAttribute("href")
               
            const issueCardsList = Array.from(document.querySelectorAll('.issue-card')).filter(card => card.querySelector('input[type="checkbox"]:checked'));
          
            if (issueCardsList.length === 1) {
                 const summary = issueCardsList[0].querySelector('.issue_description > p').innerText.trim();
                 const issueId = issueCardsList[0].querySelector('.issue-id').innerText.trim();
                 const impact = issueCardsList[0].querySelector(".issue-impact").innerText.trim();
                 const tags = Array.from(issueCardsList[0].querySelectorAll('.tag_list span')).map(el => el.innerText.trim()).join(', ');
                 const expectedResult =  issueCardsList[0].querySelector(".help-section").innerText.trim();
                 const fixLink = issueCardsList[0].querySelector(".fix-link").getAttribute('href');
                 const issues = Array.from(issueCardsList[0].querySelectorAll('.issue-card .failure-list li')).map(el => el.innerText.trim())
                 const actualResult = "\\n- " + issues.join(" OR\\n- ");
                 const affectedElements = Array.from(issueCardsList[0].querySelectorAll('.issue-card .node-html div')).map(el => el.innerText.trim()).join('\\n');
                    
                 bugTitle.value = "[A11y] " + summary + " at " + pageTitle + " page";
           
                 summaryEl.value = 
                    "**Issue Id:** " + issueId + "\\n\\n" +
                    "**URL:** " + pageUrl + "\\n\\n" +
                    "**Impact:** " + impact + "\\n\\n" +
                    "**Tags:** " + tags + "\\n\\n" +
                    "**Steps:**\\n...\\n\\n"  +
                    "**Expected Result:** " + expectedResult + "\\n\\n" +
                    "**Actual Result:** " + actualResult + "\\n\\n" + 
                    "**Affected Elements:**\\n\`\`\`html" + affectedElements + "\\n\`\`\`\\n\\n" + 
                    "**Help Link:** " + fixLink; 
            } else {
                const templateContainer = []
                 for (let i = 0; i < issueCardsList.length; i++) {
                      const summary = issueCardsList[i].querySelector('.issue_description > p').innerText.trim();
                     const impact = issueCardsList[i].querySelector(".issue-impact").innerText.trim();
                     const impactColored = impact === 'critical' ? "🟥 " + impact : impact === 'serious' ? '🟧 ' + impact : impact === 'moderate' ? '🟩 ' + impact : impact;
                     const issueId = issueCardsList[i].querySelector('.issue-id').innerText.trim();
                     const issues = Array.from(issueCardsList[i].querySelectorAll('.issue-card .failure-list li')).map(el => el.innerText.trim())
                     const expectedResult =  issueCardsList[i].querySelector(".help-section").innerText.trim();
                     const affectedElements = Array.from(issueCardsList[i].querySelectorAll('.issue-card .node-html div')).map(el => el.innerText.trim()).join('\\n');
                     const fixLink = issueCardsList[i].querySelector(".fix-link").getAttribute('href');
                     
                     const tmp =
                          "** #" + (i + 1) + " " + impactColored + " – " + issueId + "**\\n\\n" +
                          "**Affected Elements:**\\n\\n" +
                          "\`\`\`html\\n" + affectedElements + "\\n\`\`\`\\n\\n" +
                          "**Issue:** " + summary + "\\n\\n" +
                          "**Fix:** " + expectedResult + "\\n\\n" +
                          "**Help Link:** " + fixLink;
                     templateContainer.push(tmp);
                 }
                 
                  bugTitle.value = "[A11y] Accessibility Issues on Page: " + pageTitle;
                  summaryEl.value = "**URL: **" +pageUrl + "\\n\\n" + templateContainer.join("\\n\\n---\\n\\n");
            }

            modal.classList.remove('hidden'); // 💡 this makes it visible
        });

        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
        
        document.getElementById('copyBugSummaryBtn').addEventListener('click', function() {
            const summary = document.getElementById('bugSummary');
            summary.select();
            document.execCommand('copy');
        });
        
        document.getElementById('copyBugTitleBtn').addEventListener('click', function() {
            const title = document.getElementById('bugTitle');
            title.select();
            document.execCommand('copy');
        });

        window.addEventListener('DOMContentLoaded', () => {
            const violationsTab = document.querySelector('[data-tab="violations"]');
            if (violationsTab) violationsTab.click();
    
            const impactFilter = document.getElementById("impact-filter");
            const tagFilter = document.getElementById("tag-filter");
            const disabilityFilter = document.getElementById("disability-filter");
    
            if (impactFilter) impactFilter.addEventListener("change", () => applyFilters(impactFilter, tagFilter, disabilityFilter));
            if (tagFilter) tagFilter.addEventListener("change", () => applyFilters(impactFilter, tagFilter, disabilityFilter));
            if (disabilityFilter) disabilityFilter.addEventListener("change", () => applyFilters(impactFilter, tagFilter, disabilityFilter));
    
            
            
            
        });
        
        document.querySelectorAll('.toggle-details').forEach(button => {
            button.addEventListener('click', () => {
                const details = button.nextElementSibling;
                details.classList.toggle('expanded');
                button.classList.toggle('expanded');
         });
            })
            
        document.querySelectorAll('.toggle-details').forEach(button => {
            button.addEventListener('click', function (e) {
                e.stopPropagation(); // Prevent event bubbling to parent elements
                const nodeDetails = this.nextElementSibling;
                nodeDetails.classList.toggle('hidden');

                // Update button text based on state
                if (nodeDetails.classList.contains('hidden')) {
                    this.innerHTML = '<i class="fas fa-chevron-down"></i> Show failure details';
                } else {
                    this.innerHTML = '<i class="fas fa-chevron-up"></i> Hide failure details';
                }
            });
        });
        

    </script>`
}

function buildGroupedTagOptions(tags) {
    const families = [
        { label: 'WCAG', match: t => t.startsWith('wcag') },
        { label: 'EN 301 549', match: t => t.startsWith('en-') },
        { label: 'RGAA', match: t => t.startsWith('rgaa') },
        { label: 'Section 508', match: t => t.startsWith('section508') },
        { label: 'Trusted Tester', match: t => t.startsWith('tt') },
        { label: 'ACT Rules', match: t => t === 'act' },
        { label: 'Category', match: t => t.startsWith('cat.') },
        { label: 'Best Practice', match: t => t === 'best-practice' },
    ];
    const remaining = new Set(tags);
    const optionHtml = t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`;
    const groupHtml = (label, items) =>
        `<optgroup label="${label}">${items.map(optionHtml).join('')}</optgroup>`;

    let html = '';
    for (const family of families) {
        const matched = [...remaining].filter(family.match).sort();
        if (!matched.length) continue;
        matched.forEach(t => remaining.delete(t));
        html += groupHtml(family.label, matched);
    }
    const others = [...remaining].sort();
    if (others.length) html += groupHtml('Other', others);
    return html;
}

function generateFilters(report, affectedIndex) {
    // Extract unique impact values and tags (existing code)
    const impactValues = new Set();
    const tagValues = new Set();
    const disabilityValues = new Set();

    // Collect impacts and tags from all sections
    [...report.violations, ...report.incomplete, ...report.passes].forEach(issue => {
        if (issue.impact) {
            impactValues.add(issue.impact.toLowerCase());
        }

        // Collect all unique tags
        if (issue.tags && Array.isArray(issue.tags)) {
            issue.tags.forEach(tag => tagValues.add(tag.toLowerCase()));
        }

        // Collect all unique disability types
        if (affectedIndex) {
            const rule = affectedIndex.get(issue.id);
            if (rule && rule['disabilityTypesAffected']) {
                rule['disabilityTypesAffected'].forEach(disability => {
                    if (disability.name) {
                        disabilityValues.add(disability.name);
                    }
                });
            }
        }
    });
    // const sortedImpacts = ['Critical 🟥', 'Serious 🟧', 'Moderate 🟨', 'Minor 🟩'].filter(i => impactValues.has(i));
    // Convert to arrays and sort
    const sortedImpacts = ['critical', 'serious', 'moderate', 'minor'].filter(i => impactValues.has(i));
    const sortedTags = [...tagValues];
    const sortedDisabilities = [...disabilityValues];

    // Generate options HTML
    const impactOptions = sortedImpacts.map(impact =>
        `<option value="${impact}">${impact.charAt(0).toUpperCase() + impact.slice(1)}</option>`
    ).join('');

    const tagOptions = buildGroupedTagOptions(sortedTags);

    const disabilityOptions = sortedDisabilities.map(disability =>
        `<option value="${disability.toLowerCase()}">${disability}</option>`
    ).join('');


    return `
        <div class="mb-3 flex flex-wrap gap-4">
            <!-- Impact Filter -->
            <div class="flex-1 min-w-[200px]">
                <label for="impact-filter" class="block font-medium text-gray-700 mb-1">Filter by Impact</label>
                <select id="impact-filter" class="select2-filter w-full" multiple="multiple" data-placeholder="Select impacts...">
                    ${impactOptions}
                </select>
            </div>

            <!-- Standards/Tags Filter -->
            <div class="flex-1 min-w-[200px]">
                <label for="tag-filter" class="block font-medium text-gray-700 mb-1">Filter by Standard</label>
                <select id="tag-filter" class="select2-filter w-full" multiple="multiple" data-placeholder="Select standards...">
                    ${tagOptions}
                </select>
            </div>

            <!-- Disabilities Filter -->
            <div class="flex-1 min-w-[200px]">
                <label for="disability-filter" class="block font-medium text-gray-700 mb-1">Filter by Disability</label>
                <select id="disability-filter" class="select2-filter w-full" multiple="multiple" data-placeholder="Select disabilities...">
                    ${disabilityOptions}
                </select>
            </div>
        </div>
    `;
}

function generateTabs(report) {
    const tabs = [{
        id: 'violations',
        name: 'Violations',
        count: report.violations.length || 0,
        hoverClass: 'hover:text-red-600',
        activeClass: '[&.active]:text-red-600 [&.active]:border-b-red-500'
    },
        {
            id: 'incomplete',
            name: 'Incomplete',
            count: report.incomplete.length || 0,
            hoverClass: 'hover:text-yellow-800',
            activeClass: '[&.active]:text-yellow-800 [&.active]:border-b-yellow-800'
        },
        {
            id: 'passes',
            name: 'Passes',
            count: report.passes.length || 0,
            hoverClass: 'hover:text-green-500',
            activeClass: '[&.active]:text-green-500 [&.active]:border-b-green-500'
        }
    ];

    let tabContent = '';

    tabs.forEach(tab => {
        let svgContent;
        if (tab.id === 'violations') {
            svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18"></path>
                    <path d="m6 6 12 12"></path>
                </svg>`;
        } else if (tab.id === 'incomplete') {
            svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>`;
        } else if (tab.id === 'passes') {
            svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 6L9 17l-5-5"></path>
                </svg>`;
        }
        const tabName = tab.id;
        const selectAllCheckbox = (tabName === 'violations' || tabName === 'incomplete')
            ? `<label for="select-all-checkbox-${tabName}" class="sr-only">Select all ${tabName}</label>
       <input type="checkbox" id="select-all-checkbox-${tabName}" class="absolute left-5 w-4 h-4 mr-2" aria-label="Select all ${tabName}">`
            : '';
        tabContent += `
<div data-tab="${tab.id}" class="relative flex items-center justify-center py-2 border-b-2 hover:bg-gray-100 text-gray-500 ${tab.hoverClass} ${tab.activeClass}">
${selectAllCheckbox}
  <button ${svgContent}
    <span class="ml-2">${tab.name}</span>
    <span class="issue-count ml-2 bg-gray-200 text-gray-800 px-2 py-0.5 rounded text-sm">${tab.count}</span>
  </button></div>
`;
    });

    return `
        <div class="mb-6">
            <div class="grid grid-cols-[1fr_1fr_1fr] gap-2 border-b">
                ${tabContent}
            </div>
        </div>
    `;
}

function generateTabContent(tabName, issueCards) {
    const tabTypeText = {
        'violations': 'violation',
        'incomplete': 'incomplete',
        'passes': 'passes'
    }[tabName];

    return `
        <div data-tab-content="${tabName}" class="${tabName !== 'violations' ? 'hidden' : ''}">
            ${issueCards}
            <div class="no-results-message p-4 my-4 text-center text-gray-500 bg-gray-50 rounded-md shadow-sm hidden">
                No ${tabTypeText} issues found matching your search criteria.
            </div>
        </div>
    `;
}

function generateIssueCards(issues, affectedIndex, screenshot) {
    function getDisabilityTypes(ruleId) {
        if (!affectedIndex) return [];
        const rule = affectedIndex.get(ruleId);
        return rule ? rule['disabilityTypesAffected'] || [] : [];
    }

    let issueCards = '';
    if (!issues || issues.length === 0) {
        issueCards = `
        <div class="no-results-message p-4 my-4 text-center text-gray-500 bg-gray-50 rounded-md shadow-sm">
                No issues found matching your search criteria.
            </div>
        `;
    } else {
        for (let i = 0; i < issues.length; i++) {
            const issue = issues[i];
            issueCards += `
                <div class="issue-card mb-4 border rounded-lg" data-id="issue-card-${issue.id}">
                    <div class="py-2 px-4">
                        <div class="flex items-center gap-5 w-full cursor-pointer relative" onclick="toggleIssueCard(this)">
                        <div class="flex items-center pl-1">
                                <label for="issue-${issue.id}" class="sr-only">Select issue ${issue.id}</label>
<input type="checkbox" id="issue-${issue.id}" class="issue-checkbox w-4 h-4" onclick="event.stopPropagation();">
                            </div>
                        <div class="flex justify-between items-center mb-4 w-full block cursor-pointer relative" onclick="toggleIssueCard(this)">
                            <div class="w-full">
                                <div class="gap-2 flex items-center flex-wrap mt-2 mb-3">
                                  <span class="issue-impact issue-impact--${issue.impact || 'minor'} text-white px-2 py-0.5 rounded text-sm">${issue.impact || 'minor'}</span>
                                    <h2 class="text-base issue-id font-semibold">${issue.id}</h2>
                                    <span class="ml-auto bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-sm font-medium">${pluralize(issue.nodes.length, 'element')}</span>
                                </div>

                                <div class="issue_description" class="mb-2">
                               <p class="font-semibold text-black mb-2">${escapeHTML(issue.description)}</p>
                                </div>

                              <div class="tag_list flex flex-wrap gap-1">
                Standards: ${issue.tags.map(tag => `<span class="border text-sm px-2 py-1 rounded">${tag}</span>`).join(' ')}
            </div>

            <div class="disability_list flex flex-wrap items-center gap-1 mt-2">
                Disabilities Affected: ${getDisabilityTypes(issue.id).map(disability =>
                `<span class="disability-pill" style="--dot: var(--${escapeHTML(disability.name.toLowerCase().replace(/ /g, '-'))}-color, #9467bd);">${escapeHTML(disability.name)}</span>`
            ).join(' ')}
            </div>


                            </div>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon">
                                <path d="m9 18 9-9-9-9"/>
                            </svg>
                        </div>
                        <div class="issue-details hidden">

                        <div class="border-t pt-3">
                        <div class="flex">
                                <h2 class="font-medium mb-2 flex-1">How to fix:</h2>
                                <a href="${issue.helpUrl}" target="_blank" class="fix-link font-medium mb-2 text-blue-600 hover:text-blue-800">Learn more</a>
                        </div>
                            <div class="help-section">
                                        <p>${escapeHTML(issue.help)}</p>
                                </div>
                            </div>



                            <!-- Screenshot Section (only when an image actually exists) -->
                            ${(() => {
                                if (!screenshot) return '';
                                const shot = screenshot.replace(".png", `_${i + 1}.png`);
                                if (!fs.existsSync(getOutputPath(PAGES_DIR, shot))) return '';
                                return `
<div class="border-t pt-3">
    <h2 class="font-medium mb-2">Page Screenshot:</h2>
    <div class="node-item">
        <img src="./${shot}" alt="${escapeHTML(shot)} screenshot" class="w-full h-auto rounded" />
    </div>
</div>
`;
                            })()}
                           

                            <!-- Nodes Section - Compact Version -->
                            <div class="border-t pt-3">
                                <h2 class="font-medium mb-2">Affected Elements (${issue.nodes.length}):</h2>
                                <div class="nodes-list">
                                     <div class="nodes-list">
                                         ${issue.nodes.map((node, index) => `   
                                                 <div class="node-item">
                                                         <div class="node-html">
                                                            <span class="element-number bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-sm mr-2">#${index + 1}</span>
                                                           <code>${escapeHTML(node.target[0])}</code>
                                                            <button class="copy-button" aria-label="Copy to clipboard" data-selector="${escapeHTML(node.target[0])}" onclick="copyToClipboard(this.dataset.selector)">
    <svg xmlns="http://www.w3.org/2000/svg"
     width="18" height="18"
     viewBox="0 0 24 24"
     fill="none"
     stroke="currentColor"
     stroke-width="2"
     stroke-linecap="round"
     stroke-linejoin="round"
     aria-hidden="true"
     focusable="false">
  <rect x="8" y="8" width="12" height="12" rx="2" ry="2"></rect>
  <rect x="4" y="4" width="12" height="12" rx="2" ry="2"></rect>
</svg>
</button>
                                                            <div style="margin: 5px 50px; font-size: 12px">${escapeHTML(node.html)}</div>
                                                        </div>
                                                         <button class="toggle-details">
                                                            <i class="fas fa-chevron-down"></i> Show failure details
                                                        </button>
                                                         <div class="node-details hidden">
                                                        <div class="failure-summary">
                                                           <h4>${node.any && node.any.length ? "Fix any of the following:" : (node.all && node.all.length ? "Fix ALL of the following:" : "Fix the following:")}</h4>
                                                            <ul class="failure-list">
                                                                ${node.any && node.any.length
                ? node.any.map(item => `<li>${escapeHTML(item.message)}</li>`).join('')
                : node.all && node.all.length
                    ? node.all.map(item => `<li>${escapeHTML(item.message)}</li>`).join('')
                    : '<li>No specific failure details available</li>'}
                                                            </ul>
                                                        </div>
                                                    </div>
                                                 </div>

                                         `).join('')}
                                    </div>
                                 </div>
                            </div>
                        </div>
                    </div>
                </div>  
`
        }
    }
    return issueCards;
}

function combineIssueCards(issues) {
    return `
       ${generateTabContent('violations', issues[0])}
       ${generateTabContent('incomplete', issues[1])}
       ${generateTabContent('passes', issues[2])}
    `;
}

function generateSummaryCart(stats) {
    const {
        violationsRulesTotalCount,
        violationElementsTotalCount,
        incompleteRulesTotalCount,
        incompleteElementsTotalCount,
        passesRulesTotalCount,
        passesElementsTotalCount,
        totalRulesReports,
        totalElementsReports
    } = stats.summary;

    const passRate = totalElementsReports > 0
        ? Math.round((passesElementsTotalCount / totalElementsReports) * 100)
        : 100;
    const passRateLevel = passRate >= 95 ? 'good' : passRate >= 80 ? 'warn' : 'poor';

    return `
    <div class="health-banner health-banner--${passRateLevel}" role="group" aria-label="Overall accessibility health">
      <div class="health-score">
        <span class="health-score-value">${passRate}%</span>
        <span class="health-score-label">checks passing</span>
      </div>
      <div class="health-meter" role="img" aria-label="${passRate}% of checks passing">
        <div class="health-meter-fill" style="width: ${passRate}%;"></div>
      </div>
      <p class="health-detail">${pluralize(passesElementsTotalCount, 'passing check')} of ${totalElementsReports} · ${pluralize(violationElementsTotalCount, 'violation')}, ${pluralize(incompleteElementsTotalCount, 'item')} to review</p>
    </div>
    <div class="icon-cards">
             <div class="icon-card">
    <div class="card-icon icon-total">
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V6"></path><path d="m5 12 7-7 7 7"></path></svg>
    </div>
    <div class="icon-content">
      <h2 class="icon-title">Total Checks</h2>
      <p class="icon-value">${pluralize(totalElementsReports, 'Element')}</p>
       <p class="rule-value">Across <strong>${pluralize(totalRulesReports, 'Rule')}</strong></p>
    </div>
  </div>
           <div class="icon-card">
    <div class="card-icon icon-violations">
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
    </div>
    <div class="icon-content">
      <h2 class="icon-title icon-title--violations">Violations</h2>
      <p class="icon-value">${pluralize(violationElementsTotalCount, 'Element')}</p>
        <p class="rule-value">Across <strong>${pluralize(violationsRulesTotalCount, 'Rule')}</strong></p>
    </div>
  </div>
            <div class="icon-card">
    <div class="card-icon icon-incomplete">
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
    </div>
    <div class="icon-content">
     <h2 class="icon-title icon-title--incomplete">Incomplete</h2>
      <p class="icon-value">${pluralize(incompleteElementsTotalCount, 'Element')}</p>
        <p class="rule-value">Across <strong>${pluralize(incompleteRulesTotalCount, 'Rule')}</strong></p>
    </div>
  </div>
            <div class="icon-card">
    <div class="card-icon icon-passes">
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
    </div>
    <div class="icon-content">
     <h2 class="icon-title icon-title--passes">Passes</h2>
      <p class="icon-value">${pluralize(passesElementsTotalCount, 'Element')}</p>
        <p class="rule-value">Across <strong>${pluralize(passesRulesTotalCount, 'Rule')}</strong></p>
    </div>
  </div>
        </div>
    `
}

// Fixed display order so a page's viewports read desktop → mobile → tablet.
// Anything not listed sorts after these, then alphabetically by name.
const VIEWPORT_ORDER = ['desktop', 'mobile', 'tablet'];

function viewportRank(viewport) {
    const idx = VIEWPORT_ORDER.indexOf(viewport || 'desktop');
    return idx === -1 ? VIEWPORT_ORDER.length : idx;
}

function renderViewportBadge(viewport) {
    if (!viewport) return '';  // only multi-viewport scans (not released yet) record one
    const name = viewport;
    return `<span class="viewport-badge viewport-badge--${escapeHTML(name)}" title="Scanned viewport">${escapeHTML(name)}</span>`;
}

function generateTableCards(stats) {
    let tableData = stats.tableRows.slice();

    // Default sort: Violations desc
    let sortKey = 'critical_elements';
    let sortDir = 'desc';

    // Table header with sort icons
    function getSortIcon(col) {
        const icon = sortKey === col ? (sortDir === 'asc' ? '↑' : '↓') : '';
        return `<span class="sort-icon" data-sort-icon="${col}" style="display:inline-block;width:1em;">${icon}</span>`;
    }

    let tableHeader = `
        <tr>
            <th class="border-col" data-sort="pagePath">Page ${getSortIcon('pagePath')}</th>
            <th class="center-cell" data-sort="critical_elements">Critical ${getSortIcon('critical_elements')}</th>
            <th class="center-cell" data-sort="serious_elements">Serious ${getSortIcon('serious_elements')}</th>
            <th class="center-cell" data-sort="moderate_elements">Moderate ${getSortIcon('moderate_elements')}</th>
            <th class="center-cell" data-sort="minor_elements">Minor ${getSortIcon('minor_elements')}</th>
            <th class="center-cell" data-sort="violations">
                Rules Status
                <div class="tooltip-container">
                    <span class="tooltip-icon">ⓘ</span>
                </div>
                ${getSortIcon('violations')}
            </th>
        </tr>
    `;

    // Sorting logic. After the primary key, rows always tie-break by page and
    // then by a fixed viewport order, so a page's desktop/mobile/tablet scans
    // stay grouped together (and read in a consistent device order).
    function comparePrimary(a, b) {
        if (sortKey === 'impacts') {
            for (let i = 0; i < 4; i++) {
                if (a.impactsSortKey[i] !== b.impactsSortKey[i]) {
                    return sortDir === 'desc' ? (b.impactsSortKey[i] - a.impactsSortKey[i]) : (a.impactsSortKey[i] - b.impactsSortKey[i]);
                }
            }
            return 0;
        } else if (sortKey === 'pagePath') {
            return (sortDir === 'asc' ? 1 : -1) * a.pagePath.localeCompare(b.pagePath);
        } else if (typeof a[sortKey] === 'string') {
            return (sortDir === 'asc' ? 1 : -1) * a[sortKey].localeCompare(b[sortKey]);
        } else {
            return sortDir === 'asc' ? (a[sortKey] - b[sortKey]) : (b[sortKey] - a[sortKey]);
        }
    }

    function compareViewport(a, b) {
        return viewportRank(a.viewport) - viewportRank(b.viewport)
            || (a.viewport || 'desktop').localeCompare(b.viewport || 'desktop');
    }

    function sortTableData() {
        tableData.sort((a, b) => {
            const primary = comparePrimary(a, b);
            if (primary !== 0) return primary;
            // Group same-page rows together (unless we're already sorting by page).
            if (sortKey !== 'pagePath') {
                const byPage = a.pagePath.localeCompare(b.pagePath);
                if (byPage !== 0) return byPage;
            }
            return compareViewport(a, b);
        });
    }

    sortTableData();

    function renderTableRows() {
        return tableData.map(row => `
            <tr class="clickable-report-row"
                data-href="./pages/${row.id}.html"
                data-viewport="${escapeHTML(row.viewport || 'desktop')}"
                data-sort-page-path="${escapeHTML(row.pagePath)}"
                data-sort-critical-elements="${row.critical_elements}"
                data-sort-serious-elements="${row.serious_elements}"
                data-sort-moderate-elements="${row.moderate_elements}"
                data-sort-minor-elements="${row.minor_elements}"
                data-sort-violations="${row.violations}"
                tabindex="0"
                role="link"
                aria-label="Open report for ${escapeHTML(row.pagePath)}">
                <td class="url-cell border-col"><a href="./pages/${row.id}.html">${escapeHTML(row.pagePath)}</a>${renderViewportBadge(row.viewport)}</td>
                <td class="status-cell critical_elements center-cell">${row.critical_elements}</td>
                <td class="status-cell serious_elements center-cell">${row.serious_elements}</td>
                <td class="status-cell moderate_elements center-cell">${row.moderate_elements}</td>
                <td class="status-cell minor_elements center-cell">${row.minor_elements}</td>
              
                <td class="center-cell">
                    <span class='violation-badge violations'>${pluralize(row.violations, 'Violation')}</span>
                    <span class='violation-badge incomplete'>${row.incomplete} Incomplete</span>
                    <span class='violation-badge passes'>${row.passes} Passes</span>
                </td>
            </tr>
        `).join('');
    }

    // Table with header and rows
    const tableHtml = `
        <div class="table-container">
            <table id="sortable-table">
                <thead>${tableHeader}</thead>
                <tbody id="table-body">
                    ${renderTableRows()}
                </tbody>
            </table>
        </div>
        <div id="pagination-controls"></div>
        <script>
        (function() {
            let sortKey = '${sortKey}';
            let sortDir = '${sortDir}';
            const tbody = document.getElementById('table-body');
            function sortAttributeFor(key) {
                return 'data-sort-' + key.replace(/_/g, '-').replace(/[A-Z]/g, function(letter) {
                    return '-' + letter.toLowerCase();
                });
            }
            function sortValue(row, key) {
                const value = row.getAttribute(sortAttributeFor(key)) || '';
                return key === 'pagePath' ? value : Number(value);
            }
            var VIEWPORT_ORDER = ['desktop', 'mobile', 'tablet'];
            function viewportOf(row) {
                return row.getAttribute('data-viewport') || 'desktop';
            }
            function viewportRank(row) {
                var idx = VIEWPORT_ORDER.indexOf(viewportOf(row));
                return idx === -1 ? VIEWPORT_ORDER.length : idx;
            }
            function pagePathOf(row) {
                return row.getAttribute('data-sort-page-path') || '';
            }
            function updateSortIcons() {
                document.querySelectorAll('#sortable-table [data-sort-icon]').forEach(function(icon) {
                    const col = icon.getAttribute('data-sort-icon');
                    icon.textContent = col === sortKey ? (sortDir === 'asc' ? '↑' : '↓') : '';
                });
            }
            function updateTable() {
                const rows = Array.from(tbody.querySelectorAll('tr.clickable-report-row'));
                rows.sort(function(a, b) {
                    const aValue = sortValue(a, sortKey);
                    const bValue = sortValue(b, sortKey);
                    var primary;
                    if (typeof aValue === 'string') {
                        primary = (sortDir === 'asc' ? 1 : -1) * aValue.localeCompare(bValue);
                    } else {
                        primary = sortDir === 'asc' ? (aValue - bValue) : (bValue - aValue);
                    }
                    if (primary !== 0) return primary;
                    // Keep a page's viewports grouped and in a fixed device order.
                    if (sortKey !== 'pagePath') {
                        var byPage = pagePathOf(a).localeCompare(pagePathOf(b));
                        if (byPage !== 0) return byPage;
                    }
                    return viewportRank(a) - viewportRank(b)
                        || viewportOf(a).localeCompare(viewportOf(b));
                });
                rows.forEach(function(row) {
                    tbody.appendChild(row);
                });
                updateSortIcons();
            }
            document.querySelectorAll('#sortable-table th[data-sort]').forEach(function(th) {
                th.style.cursor = 'pointer';
                th.addEventListener('click', function() {
                    const col = th.getAttribute('data-sort');
                    if (sortKey === col) {
                        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                    } else {
                        sortKey = col;
                        sortDir = 'desc';
                    }
                    updateTable();
                });
            });
            const sortableTable = document.getElementById('sortable-table');
            function openReportRow(row) {
                const href = row.getAttribute('data-href');
                if (href) window.location.href = href;
            }
            sortableTable.addEventListener('click', function(event) {
                if (event.target.closest('a')) return;
                const row = event.target.closest('tr.clickable-report-row');
                if (row) openReportRow(row);
            });
            sortableTable.addEventListener('keydown', function(event) {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const row = event.target.closest('tr.clickable-report-row');
                if (!row) return;
                event.preventDefault();
                openReportRow(row);
            });
        })();
        </script>
    `;
    return tableHtml;
}

function generateImpactDistribution(stats) {
    const totalCritical = stats.impactDistribution.Critical;
    const totalSerious = stats.impactDistribution.Serious;
    const totalModerate = stats.impactDistribution.Moderate;
    const totalMinor = stats.impactDistribution.Minor;

    return `
                <div class="chart">
    <h3 class="chart-title">Impact Distribution</h3>
    <p class="chart-subtitle">Severity of violation &amp; needs-review elements</p>
    <div class="chart-content" style="max-height: 300px; overflow-y: auto; display: flex; align-items: center; justify-content: center;">
        <canvas id="impactDistributionChart" style="max-width: 100%; height: auto;"></canvas>
    </div>
    <script>
        const ctx = document.getElementById('impactDistributionChart').getContext('2d');
        new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Critical', 'Serious', 'Moderate', 'Minor'],
                datasets: [{
                    data: [${totalCritical}, ${totalSerious}, ${totalModerate}, ${totalMinor}],
                   backgroundColor: ['#b91c1c', '#b25000', '#b28900', '#2e7d32'],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            boxWidth: 20,
                            padding: 15,
                             font: {
                                size: 14
                            }  
                        }
                    }
                }
            }
        });
    </script>
</div>`;
}

function generateDisabilityAffected(stats) {
    const disabilityCounts = stats.disabilityCounts;
    const totalReportsWithAllIssues = stats.disabilityIssueTotal || 1;

    return `
     <div class="chart">
    <h3 class="chart-title">Disabilities Affected</h3>
     <div class="horizontal-bar-chart" tabindex="0" style="max-height: 280px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #666 #f1f1f1; padding-right: 8px;">
        ${Object.entries(disabilityCounts).sort((a, b) => b[1] - a[1]).map(([disability, count]) => {
        const percentage = ((count / totalReportsWithAllIssues) * 100).toFixed(1);
        return `
                <div class="bar-item mb-2">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-sm font-medium">${disability}</span>
                        <span class="text-sm text-gray-500">${percentage}% (${count})</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded h-4">
                        <div class="h-4 rounded" style="width: ${percentage}%; background-color: var(--${disability.toLowerCase().replace(/ /g, "-")}-color);"></div>
                    </div>
                </div>
            `;
    }).join('')}
    </div>
</div>
    `
}

function generateDashboardSearchBar(viewports = []) {
    // Only offer the viewport filter when the run actually covered more than one
    // viewport; single-viewport reports keep the original, simpler filter bar.
    const distinctViewports = [...new Set(viewports.map(v => v || 'desktop'))]
        .sort((a, b) => viewportRank(a) - viewportRank(b) || a.localeCompare(b));
    const viewportFilter = distinctViewports.length > 1
        ? `
            <select id="filter-viewport" aria-label="Filter pages by viewport">
                <option value="all">All Viewports</option>
                ${distinctViewports.map(v =>
                    `<option value="${escapeHTML(v)}">${escapeHTML(v.charAt(0).toUpperCase() + v.slice(1))}</option>`
                ).join('')}
            </select>`
        : '';

    return `
<div class="search-and-filters">
        <div class="search-box">
            <input type="text" id="dashboard-search-input" placeholder="Search pages..." class="search-input">
            <button id="dashboard-search-button" class="search-button" aria-label="Search">
    <span class="visually-hidden">Search</span>
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"></path>
    </svg>
</button>
        </div>
        <div class="filters">
            <select id="filter-priority" aria-label="Filter pages by priority">
                <option value="all">All Pages</option>
                <option value="critical">Pages with Critical Issues</option>
                <option value="serious">Pages with Serious Issues</option>
                <option value="moderate">Pages with Moderate Issues</option>
                <option value="minor">Pages with Minor Issues</option>
                <option value="violation">Pages with Violation Rules</option>
                <option value="incomplete">Pages with Incomplete Rules</option>
            </select>
            ${viewportFilter}
        </div>
    </div>
    `;
}

// Main function to generate the report
function generateReport(reports, template, affectedIndex) {
    const concurrency = getReportConcurrency();
    return mapWithConcurrency(reports, concurrency, report => {
        let baseContent = generateBaseContent(template, report);
        let tabs = generateTabs(report);
        let violationsIssueCards = generateIssueCards(report.violations, affectedIndex, report.id + "_violations.png");
        let incompleteIssueCards = generateIssueCards(report.incomplete, affectedIndex, report.id + "_incomplete.png");
        let passedIssueCards = generateIssueCards(report.passes, affectedIndex);

        baseContent = baseContent.replace("{{FILTERS}}", generateFilters(report, affectedIndex));
        baseContent = baseContent.replace("{{TABS}}", tabs);
        baseContent = baseContent.replace("{{ISSUE_CARDS}}", combineIssueCards([violationsIssueCards, incompleteIssueCards, passedIssueCards]));
        baseContent = baseContent.replace("./main.js", "../main.js");
        baseContent = baseContent.replace("./styles.css", "../styles.css");

        // deduplicate() gives every report an id (the JSON file name).
        return fs.promises.writeFile(getOutputPath(PAGES_DIR, report.id + ".html"), baseContent, 'utf8');
    });
}

function generateDashboard(reports, template, stats) {
    const outputPath = getOutputPath('index.html');

    let dashboardBody = generateBaseDashboard(template);
    const summaryCards = generateSummaryCart(stats);
    const availableViewports = stats.tableRows.map(row => row.viewport || 'desktop');
    const dashboardSearchBar = generateDashboardSearchBar(availableViewports);
    const tableCards = generateTableCards(stats);
    const impactDistributionChart = generateImpactDistribution(stats);
    const disabilityAffected = generateDisabilityAffected(stats);

    dashboardBody = dashboardBody.replace('{{summary_cards}}', summaryCards);
    dashboardBody = dashboardBody.replace('{{impact_distribution_chart}}', impactDistributionChart);
    dashboardBody = dashboardBody.replace('{{disabilities_affected_chart}}', disabilityAffected);
    dashboardBody = dashboardBody.replace('{{dashboard_search_bar}}', dashboardSearchBar);
    dashboardBody = dashboardBody.replace('{{table_cards}}', tableCards);

    fs.writeFileSync(outputPath, dashboardBody, 'utf8');

    console.log(`Report successfully generated: file://${getOutputPath('index.html')}`);
}

// Delete every report JSON and its screenshots for the given uuids. Lists the
// pages directory once (instead of once per uuid) and relies on unlinkSync being
// synchronous — no post-delete polling needed.
function deleteReportsByUuid(uuids) {
    if (!uuids || uuids.length === 0) return;
    const uuidSet = new Set(uuids);
    const dir = getOutputPath(PAGES_DIR);
    for (const file of fs.readdirSync(dir)) {
        // File names are `${uuid}.json` or `${uuid}_violations_1.png`; the uuid
        // contains no `.`/`_`, so the first such delimiter ends it.
        const prefix = file.split(/[._]/)[0];
        if (uuidSet.has(prefix)) {
            const filePath = getOutputPath(PAGES_DIR, file);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }
}

function deduplicate(strategy) {
    const reports = getReportFiles().map(file => {
        const filePath = getOutputPath(PAGES_DIR, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        const fileId = path.basename(file, '.json');
        if (!data.id) {
            data.id = fileId;
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        }
        return {
            uuid: fileId,
            data,
            timestamp: new Date(data.timestamp),
            raw
        };
    });

    if (strategy === 'none') {
        return reports.map(report => report.data);
    }

    if (strategy === 'exact') {
        const seen = new Map();
        const toDelete = [];
        for (const report of reports) {
            // Only compare url, incomplete, violations
            const dataCopy = {
                url: report.data.url,
                viewport: report.data.viewport || 'desktop',
                incomplete: report.data.incomplete?.flatMap(i => i.nodes?.flatMap(n => n.target) || []) || [],
                violations: report.data.violations?.flatMap(i => i.nodes?.flatMap(n => n.target) || []) || []
            };

            const key = JSON.stringify(dataCopy);
            if (seen.has(key)) {
                toDelete.push(report.uuid);
            } else {
                seen.set(key, report);
            }
        }
        deleteReportsByUuid(toDelete);
        const deleted = new Set(toDelete);
        return reports.filter(report => !deleted.has(report.uuid)).map(report => report.data);
    }

    if (strategy === 'best') {
        const bestReports = new Map();
        const toDelete = [];

        for (const report of reports) {
            if (!report.data.newUrl) {
                continue;
            }

            // Key by the normalized URL, not `path`: `path` turns every symbol into
            // "-", so /user-settings and /user/settings would collide. Key by
            // viewport too, so a page's desktop and mobile scans don't evict each other.
            const key = `${report.data.newUrl}::${report.data.viewport || 'desktop'}`;
            const existing = bestReports.get(key);

            const reportViolations = getIssues(report.data, 'violations');
            const reportIncomplete = getIssues(report.data, 'incomplete');
            const existingViolations = existing ? getIssues(existing.data, 'violations') : [];
            const existingIncomplete = existing ? getIssues(existing.data, 'incomplete') : [];

            if (
                !existing ||
                reportViolations.length > existingViolations.length ||
                (reportViolations.length === existingViolations.length &&
                    reportIncomplete.length > existingIncomplete.length) ||
                (reportViolations.length === existingViolations.length &&
                    reportIncomplete.length === existingIncomplete.length &&
                    report.timestamp > existing.timestamp)
            ) {
                if (existing) toDelete.push(existing.uuid);
                bestReports.set(key, report);
            } else {
                toDelete.push(report.uuid);
            }
        }

        deleteReportsByUuid(toDelete);
        const deleted = new Set(toDelete);
        return reports.filter(report => !deleted.has(report.uuid)).map(report => report.data);
    }

    return reports.map(report => report.data);
}

function generateCategoryImpactSummary(print = true, reports = null, stats = null) {
    if (!reports) {
        reports = getReportFiles().map(file => {
            const filePath = getOutputPath(PAGES_DIR, file);
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw);
        });
    }

    if (reports.length === 0) {
        const impactSummary = createEmptyImpactSummary();
        if (print) {
            console.log("\nNo accessibility scan results found. Skipping accessibility summary.\n");
        }
        return impactSummary;
    }

    const impactSummary = (stats || buildReportStats(reports)).impactSummary;

    fs.writeFileSync(getOutputPath('impactSummary.json'), JSON.stringify(impactSummary, null, 2), 'utf-8');
    if (print) {
        const colors = {
            reset: "\x1b[0m",
            red: "\x1b[31m",
            yellow: "\x1b[33m",
            green: "\x1b[32m",
            cyan: "\x1b[36m",
            gray: "\x1b[90m",
            bold: "\x1b[1m"
        };

        console.log(`\n${colors.bold}Summary${colors.reset}\n${colors.gray}────────────────────────────────────────────────────────────────────────────── ${colors.reset}`)

        const impacts = ["Critical", "Serious", "Moderate", "Minor"];
        for (const impact of impacts) {
            const vCount = impactSummary.Violations[impact];
            const iCount = impactSummary.Incomplete[impact];
            const total = vCount + iCount;

            let color = colors.gray;
            if (impact === "Critical") color = colors.red;
            else if (impact === "Serious") color = colors.yellow;
            else if (impact === "Moderate") color = colors.cyan;

            console.log(
                `${impact.padEnd(8)}: ${color}${total.toString().padStart(5)}${colors.reset}  (Violations: ${vCount.toString().padStart(3)} + Incomplete: ${iCount.toString().padStart(3)})`
            );
        }

        console.log(`Passed  :  ${colors.green}${impactSummary.Passed}${colors.reset}\n`);
    }
    return impactSummary;
}

// Returns true when a threshold is exceeded and allowFailure is off.
// Callers decide how to stop (the CLI exits, the reporter returns a failed status).
function test(allowFailure = false, reports = null, stats = null) {
    const preparedReports = reports || deduplicate(MERGE_STRATEGY);
    const preparedStats = stats || buildReportStats(preparedReports);
    const res = generateCategoryImpactSummary(false, preparedReports, preparedStats);
    const colors = {
        reset: "\x1b[0m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        gray: "\x1b[90m",
        bold: "\x1b[1m",
        orange: "\x1b[38;5;208m"
    };

    console.log(`\n${colors.bold}Accessibility Quality Gate Evaluation${colors.reset}\n${colors.gray}────────────────────────────────────────────────────────────────────────────── ${colors.reset}`)

    if (preparedReports.length === 0) {
        console.log(`${colors.bold}No accessibility scan results found, skipping pass/fail check.${colors.reset}\n`);
        return false;
    }

    // Each threshold is a comma list ordered Critical, Serious, Moderate, Minor; blank entries are skipped.
    const gates = [
        ['VIOLATION_THRESHOLD', 'Violation', res.Violations],
        ['INCOMPLETE_THRESHOLD', 'Incomplete', res.Incomplete],
    ];
    if (gates.every(([name]) => !process.env[name])) {
        console.log(`${colors.bold}No thresholds set, skipping pass/fail check.${colors.reset}\n`);
        return false;
    }

    const prefix = allowFailure === true ? `${colors.orange}WARN` : `${colors.red}FAIL`;
    const logs = [];
    let fail = false;
    for (const [name, label, counts] of gates) {
        const impacts = Object.keys(counts);
        (process.env[name] || '').split(',').forEach((entry, i) => {
            const value = entry.trim();
            if (value === '' || i >= impacts.length) return;
            const max = Number(value);
            if (!Number.isFinite(max)) {
                throw new Error(`${name} entry "${value}" is not a number. Expected e.g. ${name}=0,5,10,20`);
            }
            const impact = impacts[i];
            const count = counts[impact];
            if (count > max) {
                logs.push(`${prefix}: ${impact} ${label} Threshold Exceeded (${count} > ${max})${colors.reset}\n`);
                fail = true;
            } else {
                logs.push(`${colors.green}PASS: ${impact} ${label} Threshold Not Exceeded (${count} <= ${max})${colors.reset}\n`);
            }
        });
    }

    if (!fail) {
        logs.push(`${colors.green}\nNo blocking accessibility issues. Proceeding...${colors.reset}\n`);
    } else if (allowFailure === true) {
        fail = false;
        logs.push(`${colors.orange}\nBuild continuing due to allowFailure flag set.${colors.reset}\n`);
    } else {
        logs.push(`${colors.red}\nBuild stopped due to accessibility violations.${colors.reset}\n`);
    }
    console.log(logs.join(''));
    return fail;
}

function loadAffectedIndexForReports(reports) {
    const version = reports[0]?.testEngine?.version;
    if (!version) return new Map();

    const dataDir = path.join(PACKAGE_ROOT, "disabilityAffectedData");
    let affectedPath = path.join(dataDir, `${getAxeVersion(version)}.json`);
    if (!fs.existsSync(affectedPath)) {
        // A newer axe-core than our data: use the newest mapping we ship rather than none.
        const newest = fs.readdirSync(dataDir)
            .filter(file => file.endsWith('.json'))
            .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}))
            .pop();
        if (!newest) return new Map();
        console.warn(`No disability data for axe-core ${getAxeVersion(version)}; using ${path.basename(newest, '.json')}.`);
        affectedPath = path.join(dataDir, newest);
    }

    return buildAffectedIndex(readJSONFile(affectedPath));
}

async function main() {
    console.log("Generating Accessibility Reports...");
    if (getReportFiles().length === 0) {
        console.log("No accessibility scan results found. Skipping report generation.");
        return {reports: [], stats: buildReportStats([])};
    }

    const reports = deduplicate(MERGE_STRATEGY);
    if (reports.length === 0) return {reports, stats: buildReportStats(reports)};

    const template = fs.readFileSync(path.join(PACKAGE_ROOT, 'index.template.html'), 'utf8');
    const affectedIndex = loadAffectedIndexForReports(reports);
    const stats = buildReportStats(reports, affectedIndex);

    generateCategoryImpactSummary(true, reports, stats);
    await generateReport(reports, template, affectedIndex);
    generateDashboard(reports, template, stats);

    fs.copyFileSync(path.join(PACKAGE_ROOT, 'styles.css'), getOutputPath('./styles.css'));
    fs.copyFileSync(path.join(PACKAGE_ROOT, 'main.js'), getOutputPath('./main.js'));

    return {reports, stats};
}

module.exports = {main, deduplicate, cleanUp, test, buildReportStats, generateCategoryImpactSummary};

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
