'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// buildReport.js captures OUTPUT_DIR and MERGE_STRATEGY into module-level
// constants at load time, so each test gets a freshly-required copy with its
// own temp output directory and a deterministic merge strategy.
function freshModule(env) {
    delete process.env.OUTPUT_DIR;
    delete process.env.MERGE_STRATEGY;
    Object.assign(process.env, env);
    const modPath = require.resolve('../buildReport.js');
    delete require.cache[modPath];
    return require('../buildReport.js');
}

function tmpOut() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axe-report-test-'));
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    return dir;
}

function pagesDir(dir) {
    return path.join(dir, 'pages');
}

function jsonFiles(dir) {
    return fs.readdirSync(pagesDir(dir)).filter(f => f.endsWith('.json'));
}

function writeReport(dir, report) {
    fs.writeFileSync(path.join(pagesDir(dir), report.id + '.json'), JSON.stringify(report));
}

function node(impact) {
    return { impact, html: '<x>', target: ['#x'], any: [{ message: 'm' }], all: [] };
}

function rule(id, impact, nodes) {
    return { id, impact, description: 'd', help: 'h', helpUrl: 'u', tags: ['wcag2a'], nodes };
}

let counter = 0;
function makeReport(overrides = {}) {
    counter += 1;
    return Object.assign({
        id: 'r' + counter,
        url: 'http://localhost/page',
        newUrl: '/page',
        path: '/page',
        pagePath: '/page',
        timestamp: '2026-06-26T10:00:00.000Z',
        testEngine: { name: 'axe-core', version: '4.10.0' },
        testEnvironment: { userAgent: 't', windowWidth: 1280, windowHeight: 720 },
        violations: [],
        incomplete: [],
        passes: [],
        inapplicable: []
    }, overrides);
}

// Strip HTML tags + collapse whitespace from the dashboard table body.
function tableRowText(html) {
    const m = html.match(/<tbody[\s\S]*?<\/tbody>/);
    return (m ? m[0] : '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('main() builds dashboard + page report + summary + copies assets', async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({ id: 'page1', violations: [rule('image-alt', 'critical', [node('critical')])] }));
        const mod = freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none' });
        await mod.main();

        assert.ok(fs.existsSync(path.join(dir, 'index.html')), 'dashboard index.html');
        assert.ok(fs.existsSync(path.join(pagesDir(dir), 'page1.html')), 'per-page report html');
        assert.ok(fs.existsSync(path.join(dir, 'impactSummary.json')), 'impactSummary.json');
        assert.ok(fs.existsSync(path.join(dir, 'styles.css')), 'styles.css copied');
        assert.ok(fs.existsSync(path.join(dir, 'main.js')), 'main.js copied');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('impact summary counts affected nodes by severity', async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({
            id: 'p',
            violations: [rule('a', 'critical', [node('critical'), node('serious')])],
            incomplete: [rule('b', 'moderate', [node('moderate'), node('minor')])],
            passes: [rule('c', null, [node(null), node(null)])]
        }));
        const mod = freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none' });
        await mod.main();

        const summary = JSON.parse(fs.readFileSync(path.join(dir, 'impactSummary.json'), 'utf8'));
        assert.deepStrictEqual(summary.Violations, { Critical: 1, Serious: 1, Moderate: 0, Minor: 0 });
        assert.deepStrictEqual(summary.Incomplete, { Critical: 0, Serious: 0, Moderate: 1, Minor: 1 });
        assert.strictEqual(summary.Passed, 2);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('dashboard table shows correct per-impact element and rule counts', async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({
            id: 'cart',
            pagePath: '/cart',
            violations: [
                rule('image-alt', 'critical', [node('critical')]),
                rule('color-contrast', 'serious', [node('serious'), node('serious')])
            ],
            incomplete: [rule('link-name', 'moderate', [node('moderate'), node('minor')])],
            passes: [rule('html-lang', null, [node(null)])]
        }));
        const mod = freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none' });
        await mod.main();

        const row = tableRowText(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
        // page  critical serious moderate minor  vRules ... iRules ... pRules
        assert.match(row, /\/cart\s+1\s+2\s+1\s+1\s+2\s+Violations\s+1\s+Incomplete\s+1\s+Passes/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("deduplicate('best') keeps the richer report and deletes the duplicate + its screenshot", async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({ id: 'rich', path: '/dup', newUrl: '/dup', violations: [rule('a', 'critical', [node('critical')])] }));
        writeReport(dir, makeReport({ id: 'poor', path: '/dup', newUrl: '/dup', violations: [] }));
        // a screenshot belonging to the duplicate should be removed along with its json
        fs.writeFileSync(path.join(pagesDir(dir), 'poor_violations_1.png'), 'png');

        const mod = freshModule({ OUTPUT_DIR: dir });
        mod.deduplicate('best');

        assert.ok(fs.existsSync(path.join(pagesDir(dir), 'rich.json')), 'richer report kept');
        assert.ok(!fs.existsSync(path.join(pagesDir(dir), 'poor.json')), 'duplicate json deleted');
        assert.ok(!fs.existsSync(path.join(pagesDir(dir), 'poor_violations_1.png')), 'duplicate screenshot deleted');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("deduplicate('exact') removes identical violation sets", async () => {
    const dir = tmpOut();
    try {
        const v = [rule('a', 'critical', [node('critical')])];
        writeReport(dir, makeReport({ id: 'one', url: 'http://localhost/x', violations: JSON.parse(JSON.stringify(v)) }));
        writeReport(dir, makeReport({ id: 'two', url: 'http://localhost/x', violations: JSON.parse(JSON.stringify(v)) }));

        const mod = freshModule({ OUTPUT_DIR: dir });
        mod.deduplicate('exact');

        assert.strictEqual(jsonFiles(dir).length, 1, 'one of the identical reports removed');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("deduplicate('none') keeps every report", async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({ id: 'a', path: '/dup', newUrl: '/dup' }));
        writeReport(dir, makeReport({ id: 'b', path: '/dup', newUrl: '/dup' }));

        const mod = freshModule({ OUTPUT_DIR: dir });
        mod.deduplicate('none');

        assert.strictEqual(jsonFiles(dir).length, 2);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('cleanUp removes the report output directory', async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({ id: 'p' }));
        const mod = freshModule({ OUTPUT_DIR: dir });
        mod.cleanUp();
        assert.ok(!fs.existsSync(dir), 'output directory removed');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('main() is a no-op when there are no scan results', async () => {
    const dir = tmpOut();
    try {
        const mod = freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none' });
        await mod.main();
        assert.ok(!fs.existsSync(path.join(dir, 'index.html')), 'no dashboard without results');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
