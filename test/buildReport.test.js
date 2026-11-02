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
    delete process.env.VIOLATION_THRESHOLD;
    delete process.env.INCOMPLETE_THRESHOLD;
    delete process.env.REPORT_CONCURRENCY;
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
        // page  viewport  critical serious moderate minor  vRules ... iRules ... pRules
        assert.match(row, /\/cart\s+desktop\s+1\s+2\s+1\s+1\s+2\s+Violations\s+1\s+Incomplete\s+1\s+Passes/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('dashboard groups a page\'s viewports together in fixed device order', async () => {
    const dir = tmpOut();
    try {
        // Same page, same (zero) severity so only the viewport tiebreak decides order.
        // Written mobile-first to prove the sort — not input order — drives the result.
        writeReport(dir, makeReport({ id: 'mob', pagePath: '/cart', viewport: 'mobile' }));
        writeReport(dir, makeReport({ id: 'desk', pagePath: '/cart', viewport: 'desktop' }));
        const mod = freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none' });
        await mod.main();

        const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
        const order = [...html.matchAll(/data-viewport="([^"]+)"/g)].map(m => m[1]);
        assert.deepStrictEqual(order, ['desktop', 'mobile'], 'desktop renders before mobile');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('viewport filter appears only when more than one viewport was scanned', async () => {
    const single = tmpOut();
    const multi = tmpOut();
    try {
        writeReport(single, makeReport({ id: 'a', pagePath: '/a', viewport: 'desktop' }));
        await freshModule({ OUTPUT_DIR: single, MERGE_STRATEGY: 'none' }).main();
        const singleHtml = fs.readFileSync(path.join(single, 'index.html'), 'utf8');
        assert.ok(!singleHtml.includes('id="filter-viewport"'), 'no viewport filter for a single viewport');

        writeReport(multi, makeReport({ id: 'd', pagePath: '/a', viewport: 'desktop' }));
        writeReport(multi, makeReport({ id: 'm', pagePath: '/a', viewport: 'mobile' }));
        await freshModule({ OUTPUT_DIR: multi, MERGE_STRATEGY: 'none' }).main();
        const multiHtml = fs.readFileSync(path.join(multi, 'index.html'), 'utf8');
        assert.ok(multiHtml.includes('id="filter-viewport"'), 'viewport filter rendered');
        assert.match(multiHtml, /<option value="mobile">Mobile<\/option>/);
        assert.match(multiHtml, /<option value="desktop">Desktop<\/option>/);
    } finally {
        fs.rmSync(single, { recursive: true, force: true });
        fs.rmSync(multi, { recursive: true, force: true });
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
        const kept = mod.deduplicate('best');

        assert.ok(fs.existsSync(path.join(pagesDir(dir), 'rich.json')), 'richer report kept');
        assert.ok(!fs.existsSync(path.join(pagesDir(dir), 'poor.json')), 'duplicate json deleted');
        assert.ok(!fs.existsSync(path.join(pagesDir(dir), 'poor_violations_1.png')), 'duplicate screenshot deleted');
        assert.deepStrictEqual(kept.map(report => report.id), ['rich'], 'deduplicate returns kept report data');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("deduplicate('best') keeps desktop and mobile scans of the same page", async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({ id: 'desk', path: '/dup', newUrl: '/dup', viewport: 'desktop', violations: [rule('a', 'critical', [node('critical')])] }));
        writeReport(dir, makeReport({ id: 'mob', path: '/dup', newUrl: '/dup', viewport: 'mobile', violations: [] }));

        const mod = freshModule({ OUTPUT_DIR: dir });
        const kept = mod.deduplicate('best');

        assert.ok(fs.existsSync(path.join(pagesDir(dir), 'desk.json')), 'desktop scan kept');
        assert.ok(fs.existsSync(path.join(pagesDir(dir), 'mob.json')), 'mobile scan kept despite same path');
        assert.deepStrictEqual(kept.map(report => report.id).sort(), ['desk', 'mob']);
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

test('test() checks thresholds without generating dashboard html', async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({
            id: 'gate',
            violations: [rule('image-alt', 'critical', [node('critical')])]
        }));
        const mod = freshModule({
            OUTPUT_DIR: dir,
            MERGE_STRATEGY: 'none',
            VIOLATION_THRESHOLD: '10'
        });

        const failed = mod.test(false);

        assert.strictEqual(failed, false);
        assert.ok(fs.existsSync(path.join(dir, 'impactSummary.json')), 'impact summary written');
        assert.ok(!fs.existsSync(path.join(dir, 'index.html')), 'dashboard index.html was not generated');
        assert.ok(!fs.existsSync(path.join(pagesDir(dir), 'gate.html')), 'per-page report html was not generated');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('cleanUp removes only the files the report writes', async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({ id: 'p' }));
        fs.writeFileSync(path.join(dir, 'index.html'), 'old');
        fs.writeFileSync(path.join(dir, 'keep.txt'), 'not ours');
        const mod = freshModule({ OUTPUT_DIR: dir });
        mod.cleanUp();
        assert.ok(!fs.existsSync(pagesDir(dir)), 'pages removed');
        assert.ok(!fs.existsSync(path.join(dir, 'index.html')), 'dashboard removed');
        assert.ok(fs.existsSync(path.join(dir, 'keep.txt')), 'unrelated file kept');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('cleanUp refuses an OUTPUT_DIR that is the working directory', async () => {
    const dir = tmpOut();
    const cwd = process.cwd();
    try {
        fs.writeFileSync(path.join(dir, 'main.js'), 'user code');
        process.chdir(dir);
        const mod = freshModule({ OUTPUT_DIR: '.' });
        assert.throws(() => mod.cleanUp(), /OUTPUT_DIR/);
        assert.ok(fs.existsSync(path.join(dir, 'main.js')), 'user file untouched');
        assert.ok(fs.existsSync(pagesDir(dir)), 'nothing deleted');
    } finally {
        process.chdir(cwd);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("deduplicate('best') keeps pages whose paths differ only by symbols", async () => {
    const dir = tmpOut();
    try {
        // Both format to path "/user-settings"; they are still different pages.
        writeReport(dir, makeReport({ id: 'dash', path: '/user-settings', newUrl: '/user-settings' }));
        writeReport(dir, makeReport({ id: 'slash', path: '/user-settings', newUrl: '/user/settings' }));

        const kept = freshModule({ OUTPUT_DIR: dir }).deduplicate('best');

        assert.deepStrictEqual(kept.map(report => report.id).sort(), ['dash', 'slash']);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('test() skips blank threshold entries and rejects non-numbers', async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({
            id: 'gate',
            violations: [rule('a', 'critical', [node('critical')]), rule('b', 'serious', [node('serious')])]
        }));
        // Blank VIOLATION_THRESHOLD must not mean "0 allowed".
        let mod = freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none', VIOLATION_THRESHOLD: '', INCOMPLETE_THRESHOLD: '5' });
        assert.strictEqual(mod.test(false), false);

        // A blank slot skips Serious; Critical 1 > 0 still fails.
        mod = freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none', VIOLATION_THRESHOLD: '5,,5' });
        assert.strictEqual(mod.test(false), false);
        mod = freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none', VIOLATION_THRESHOLD: '0' });
        assert.strictEqual(mod.test(false), true);
        assert.strictEqual(mod.test(true), false, 'allowFailure turns the failure into a warning');

        mod = freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none', VIOLATION_THRESHOLD: 'abc' });
        assert.throws(() => mod.test(false), /not a number/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a newer axe-core version falls back to the newest disability data', async () => {
    const dir = tmpOut();
    try {
        writeReport(dir, makeReport({
            id: 'future',
            testEngine: { name: 'axe-core', version: '99.0.0' },
            violations: [rule('image-alt', 'critical', [node('critical')])]
        }));
        await freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none' }).main();
        const html = fs.readFileSync(path.join(pagesDir(dir), 'future.html'), 'utf8');
        assert.match(html, /disability-pill[^>]*>Blind</);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('copy button keeps CSS-escaped selectors out of inline JS strings', async () => {
    const dir = tmpOut();
    try {
        const n = Object.assign(node('critical'), { target: ['#\\31 23'] });
        writeReport(dir, makeReport({ id: 'sel', violations: [rule('image-alt', 'critical', [n])] }));
        await freshModule({ OUTPUT_DIR: dir, MERGE_STRATEGY: 'none' }).main();
        const html = fs.readFileSync(path.join(pagesDir(dir), 'sel.html'), 'utf8');
        assert.ok(html.includes('data-selector="#\\31 23" onclick="copyToClipboard(this.dataset.selector)"'));
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
