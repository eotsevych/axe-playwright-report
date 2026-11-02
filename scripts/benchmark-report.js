#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {performance} = require('perf_hooks');

function option(name, fallback) {
    const prefix = `--${name}=`;
    const arg = process.argv.slice(2).find(value => value.startsWith(prefix));
    if (!arg) return fallback;
    const parsed = Number.parseInt(arg.slice(prefix.length), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function directorySize(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) total += directorySize(fullPath);
        else total += fs.statSync(fullPath).size;
    }
    return total;
}

function node(impact, index) {
    return {
        impact,
        html: `<button id="button-${index}">Save</button>`,
        target: [`#button-${index}`],
        any: [{id: 'check', impact, message: `Fix ${impact || 'issue'} state`}],
        all: []
    };
}

function rule(id, impact, nodeCount, offset) {
    return {
        id,
        impact,
        description: `${id} description`,
        help: `${id} help`,
        helpUrl: `https://dequeuniversity.com/rules/axe/4.12/${id}`,
        tags: ['wcag2a'],
        nodes: Array.from({length: nodeCount}, (_, index) => node(impact, offset + index))
    };
}

function report(index, rulesPerSection, nodesPerRule) {
    const impacts = ['critical', 'serious', 'moderate', 'minor'];
    const makeRules = section => Array.from({length: rulesPerSection}, (_, ruleIndex) => {
        const impact = impacts[(index + ruleIndex) % impacts.length];
        return rule(`${section}-${ruleIndex}`, impact, nodesPerRule, index * 1000 + ruleIndex * nodesPerRule);
    });

    return {
        id: `report-${index}`,
        url: `http://localhost/page/${index}`,
        newUrl: `/page/${index}`,
        path: `/page/${index}`,
        pagePath: `/page/${index}`,
        timestamp: new Date(1760000000000 + index).toISOString(),
        testEngine: {name: 'axe-core', version: '4.12.0'},
        testEnvironment: {userAgent: 'benchmark', windowWidth: 1280, windowHeight: 720},
        violations: makeRules('violation'),
        incomplete: makeRules('incomplete'),
        passes: makeRules('pass'),
        inapplicable: []
    };
}

async function main() {
    const reportCount = option('reports', 100);
    const rulesPerSection = option('rules', 4);
    const nodesPerRule = option('nodes', 5);
    const keep = process.argv.includes('--keep');
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axe-report-benchmark-'));
    const pagesDir = path.join(outputDir, 'pages');
    fs.mkdirSync(pagesDir, {recursive: true});

    process.env.OUTPUT_DIR = outputDir;
    process.env.MERGE_STRATEGY = 'none';
    process.env.REPORT_CONCURRENCY = process.env.REPORT_CONCURRENCY || '4';

    for (let index = 0; index < reportCount; index++) {
        const data = report(index, rulesPerSection, nodesPerRule);
        fs.writeFileSync(path.join(pagesDir, `${data.id}.json`), JSON.stringify(data));
    }

    const build = require('../buildReport.js');
    const startMemory = process.memoryUsage().rss;
    const start = performance.now();
    await build.main();
    const durationMs = performance.now() - start;
    const endMemory = process.memoryUsage().rss;
    const sizeBytes = directorySize(outputDir);

    console.log(JSON.stringify({
        reports: reportCount,
        rulesPerSection,
        nodesPerRule,
        durationMs: Math.round(durationMs),
        rssDeltaMb: Number(((endMemory - startMemory) / 1024 / 1024).toFixed(1)),
        outputSizeMb: Number((sizeBytes / 1024 / 1024).toFixed(2)),
        reportConcurrency: process.env.REPORT_CONCURRENCY,
        outputDir: keep ? outputDir : undefined
    }, null, 2));

    if (!keep) fs.rmSync(outputDir, {recursive: true, force: true});
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
