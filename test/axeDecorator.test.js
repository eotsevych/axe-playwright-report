'use strict';

const test = require('node:test');
const assert = require('node:assert');

// These unit tests cover the decorator's pure helper functions. They run
// against the compiled output in ../dist, so `npm run build` must have run
// first (the same tsc step the package publishes). Requiring dist keeps the
// TypeScript source as the single source of truth for this logic.
let decorator;
try {
    decorator = require('../dist/axeDecorator.js');
} catch (err) {
    throw new Error('Run `npm run build` before the tests: ' + err.message);
}

const { resolveViewports, parseViewports, normalizeUrl, compactAxeResult, parseCustomRegExp } = decorator;

test('resolveViewports defaults to desktop only', () => {
    assert.deepStrictEqual(resolveViewports([]), ['desktop']);
});

test('resolveViewports appends bare tokens after desktop', () => {
    assert.deepStrictEqual(resolveViewports(['mobile']), ['desktop', 'mobile']);
    assert.deepStrictEqual(resolveViewports(['mobile', 'tablet']), ['desktop', 'mobile', 'tablet']);
});

test('resolveViewports removes viewports with a ~ prefix', () => {
    assert.deepStrictEqual(resolveViewports(['mobile', '~desktop']), ['mobile']);
});

test('resolveViewports ignores duplicates, casing and blank tokens', () => {
    assert.deepStrictEqual(resolveViewports(['MOBILE', ' mobile ', '']), ['desktop', 'mobile']);
});

test('parseViewports parses name:WIDTHxHEIGHT entries', () => {
    assert.deepStrictEqual(parseViewports('mobile:390x844,tablet:768x1024'), {
        mobile: { width: 390, height: 844 },
        tablet: { width: 768, height: 1024 },
    });
});

test('parseViewports skips the reserved "desktop" name and malformed sizes', () => {
    assert.deepStrictEqual(parseViewports('desktop:100x100,bad,mobile:390xNaN'), {});
});

test('parseViewports returns an empty map for empty input', () => {
    assert.deepStrictEqual(parseViewports(''), {});
});

test('normalizeUrl replaces numeric id segments with :id', () => {
    assert.strictEqual(normalizeUrl('http://localhost/orders/12345'), '/orders/:id');
});

test('normalizeUrl keeps file-like segments and sorts wildcarded query params', () => {
    assert.strictEqual(
        normalizeUrl('http://localhost/inventory.html?b=2&a=1'),
        '/inventory.html?a=*&b=*'
    );
});

test('normalizeUrl applies custom regex patterns when provided', () => {
    const result = normalizeUrl('http://localhost/user/john', [/\/user\/[a-z]+/g]);
    assert.strictEqual(result, '/{$regExp1}');
});

test('parseCustomRegExp treats an empty value or [] as no patterns', () => {
    // An empty RegExp matches at every position and would mangle every URL.
    assert.deepStrictEqual(parseCustomRegExp(''), []);
    assert.deepStrictEqual(parseCustomRegExp(undefined), []);
    assert.deepStrictEqual(parseCustomRegExp('[]'), []);
    assert.strictEqual(normalizeUrl('http://localhost/users/42', parseCustomRegExp('')), '/users/:id');
});

test('parseCustomRegExp parses a quoted list into global regexes', () => {
    const patterns = parseCustomRegExp('["^\\/a\\d+$", "\\/b"]');
    assert.deepStrictEqual(patterns.map(p => p.source), ['^\\/a\\d+$', '\\/b']);
    assert.ok(patterns.every(p => p.flags === 'g'));
});

test('compactAxeResult keeps summary fields and trims node checks to id/impact/message', () => {
    const full = {
        id: 'r1',
        viewport: 'desktop',
        url: 'http://localhost/x',
        timestamp: 't',
        violations: [{
            id: 'image-alt',
            impact: 'critical',
            tags: ['wcag2a'],
            description: 'd',
            help: 'h',
            helpUrl: 'u',
            extraneous: 'dropme',
            nodes: [{
                impact: 'critical',
                html: '<img>',
                target: ['img'],
                failureSummary: 'dropme',
                any: [{ id: 'has-alt', impact: 'critical', message: 'm', data: 'dropme' }],
                all: [],
            }],
        }],
        incomplete: [],
        passes: [],
        inapplicable: [],
    };

    const compact = compactAxeResult(full);

    assert.strictEqual(compact.id, 'r1');
    assert.strictEqual(compact.violations[0].extraneous, undefined);
    assert.deepStrictEqual(compact.violations[0].nodes[0].any, [
        { id: 'has-alt', impact: 'critical', message: 'm' },
    ]);
    assert.strictEqual(compact.violations[0].nodes[0].failureSummary, undefined);
});
