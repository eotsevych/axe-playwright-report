import {Locator, Page} from '@playwright/test';
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * A decorator that runs an accessibility scan using Axe after executing the decorated method.
 *
 * **Usage Instructions**:
 * 1. This decorator should be assigned to methods within a **Page Object** class.
 * 2. The Page Object class should contain a parameter of type `Page` (otherwise, the accessibility scan will not be executed).
 * 3. The accessibility scan is performed after the body of the method is executed. The method will only be executed if the accessibility scan passes.
 *
 * The scan checks for common accessibility issues using the Axe-core library.
 *
 * @template This - The type of the class instance (or object) on which the decorated method is called.
 * @template Args - The type of arguments the decorated method takes.
 * @template Return - The return type of the decorated method.
 *
 * @param target - The method to be decorated. This method will be wrapped so that the Axe accessibility scan runs after it.
 *
 * @returns A new function that runs the accessibility scan after executing the original method.
 * It returns a `Promise` that resolves to the return value of the original method.
 *
 * @example
 *   @axeScan
 *   async someMethod() {
 *     this.page.getByText('Hello World').click();
 *   }
 * }
 */
export function axeScan<This, Args extends any[], Return>() {
    return function actualDecorator(target: (this: This, ...args: Args) => Promise<Return>) {
        async function scan(this: any, ...args: Args): Promise<Return> {
            const result = await target.apply(this, args);
            const accessibilityConfig = loadEnvConfig()

            if (accessibilityConfig.scan) {
                const page: Page | undefined = Object.values(this).find(isPlaywrightPage);

                if (!page) {
                    console.warn(`Page not found in context in args [${Object.values(this)}].\n(Make sure you are using the decorator on a method that has access to the Playwright Page);\nSkipping axe scan.\n`);
                    return result;
                }

                await runAxeScan(page, accessibilityConfig);
            }
            return result
        }

        return scan as (this: This, ...args: Args) => Promise<Return>;
    }
}

async function runAxeScan(page: Page, accessibilityConfig: any) {
    let axeBuilder = new AxeBuilder({page});
    if (accessibilityConfig.tags.length > 0) axeBuilder.withTags(accessibilityConfig.tags);
    if (accessibilityConfig.withRules.length > 0) axeBuilder.withRules(accessibilityConfig.withRules);
    if (accessibilityConfig.excludeRules.length > 0) axeBuilder.disableRules(accessibilityConfig.excludeRules);
    if (accessibilityConfig.exclude.length > 0) {
        accessibilityConfig.exclude.forEach((locator: string) => axeBuilder.exclude(locator));
    }
    if (accessibilityConfig.include.length > 0) {
        accessibilityConfig.include.forEach((locator: string) => axeBuilder.include(locator));
    }

    const accessibilityScanResults = await axeBuilder.analyze();

    const id = randomUUID();
    accessibilityScanResults['id'] = id;

    let url = normalizeUrl(accessibilityScanResults.url, accessibilityConfig.customRegExp);
    accessibilityScanResults['newUrl'] = url;
    accessibilityScanResults['pagePath'] = url;
    const violations = accessibilityScanResults.violations;
    const incomplete = accessibilityScanResults.incomplete;

    if (violations.length > 0 || incomplete.length > 0 || accessibilityScanResults.passes.length) {
        accessibilityScanResults['path'] = formatUrl(url);
        accessibilityScanResults['violationsScreenShot'] = `${id}_violations.png`;
        accessibilityScanResults['incompleteScreenShot'] = `${id}_incomplete.png`;
        accessibilityScanResults['inapplicableScreenShot'] = `${id}_inapplicable.png`;

        if (!fs.existsSync(accessibilityConfig.outputDir)) {
            fs.mkdirSync(accessibilityConfig.outputDir, {recursive: true});
        }

        // Drop passes from what we persist when disabled; the page is
        // still recorded (the membership check above already ran).
        if (!accessibilityConfig.includePasses) {
            accessibilityScanResults.passes = [];
        }

        const persistedResults = accessibilityConfig.resultMode === "compact"
            ? compactAxeResult(accessibilityScanResults)
            : accessibilityScanResults;

        fs.writeFileSync(`${accessibilityConfig.outputDir}/${accessibilityScanResults['id']}.json`, JSON.stringify(persistedResults, null, 2));

        if (accessibilityConfig.screenshots && accessibilityConfig.maxScreenshotsPerPage > 0) {
            let remainingScreenshots = accessibilityConfig.maxScreenshotsPerPage;
            const shouldCaptureViolations = accessibilityConfig.screenshotMode === "all" || accessibilityConfig.screenshotMode === "violations";
            if (shouldCaptureViolations) {
                const saved = await highlightEachIssuesAndSaveScreenshot(violations, page, "red", id + "_violations", accessibilityConfig.outputDir, remainingScreenshots);
                remainingScreenshots -= saved;
            }

            if (accessibilityConfig.screenshotMode === "all" && remainingScreenshots > 0) {
                await highlightEachIssuesAndSaveScreenshot(incomplete, page, "red", id + "_incomplete", accessibilityConfig.outputDir, remainingScreenshots);
            }
        }
    }
}

/**
 * Detects a Playwright `Page` by duck-typing rather than by `constructor.name`.
 *
 * Playwright renamed the internal class from `Page` to `_Page` in v1.60, which
 * broke a `constructor?.name === 'Page'` check. Checking for the methods every
 * `Page` exposes is version-agnostic and survives such internal renames.
 */
function isPlaywrightPage(prop: any): prop is Page {
    return (
        typeof prop?.goto === 'function' &&
        typeof prop?.screenshot === 'function' &&
        typeof prop?.locator === 'function' &&
        typeof prop?.context === 'function'
    );
}

function formatUrl(inputUrl: string): string {
    return "/" + inputUrl.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+|-+$/g, "");
}

export function compactAxeResult(result: any) {
    return {
        id: result.id,
        viewport: result.viewport,
        url: result.url,
        newUrl: result.newUrl,
        pagePath: result.pagePath,
        path: result.path,
        timestamp: result.timestamp,
        testEngine: result.testEngine,
        testRunner: result.testRunner,
        testEnvironment: result.testEnvironment,
        violationsScreenShot: result.violationsScreenShot,
        incompleteScreenShot: result.incompleteScreenShot,
        inapplicableScreenShot: result.inapplicableScreenShot,
        violations: compactRules(result.violations),
        incomplete: compactRules(result.incomplete),
        passes: compactRules(result.passes),
        inapplicable: compactRules(result.inapplicable),
    };
}

function compactRules(rules: any[] = []) {
    return (rules || []).map(rule => ({
        id: rule.id,
        impact: rule.impact,
        tags: rule.tags || [],
        description: rule.description,
        help: rule.help,
        helpUrl: rule.helpUrl,
        nodes: (rule.nodes || []).map(compactNode),
    }));
}

function compactNode(node: any) {
    return {
        impact: node.impact,
        html: node.html,
        target: node.target || [],
        any: compactChecks(node.any),
        all: compactChecks(node.all),
    };
}

function compactChecks(checks: any[] = []) {
    return (checks || []).map(check => ({
        id: check.id,
        impact: check.impact,
        message: check.message,
    }));
}

async function highlightEachIssuesAndSaveScreenshot(issues: any[], page: Page, color: string, fileName: string, outputDir: string, maxScreenshots: number = Number.POSITIVE_INFINITY) {
    let savedScreenshots = 0;
    for (let i = 0; i < issues.length && savedScreenshots < maxScreenshots; i++) {
        // Resolve each target locator once and remember the handles we highlighted,
        // so cleanup reuses them instead of re-querying every target a second time.
        const highlighted: Locator[] = [];

        for (let j = 0; j < issues[i].nodes.length; j++) {
            for (let k = 0; k < issues[i].nodes[j].target.length; k++) {
                try {
                    const element = (await page.locator(<string>issues[i].nodes[j].target[k]).all())[0]
                    if (!element) continue;
                    await highlightElement(element, j, color);
                    highlighted.push(element);
                } catch (ignore: any) {
                }
            }
        }

        await page.screenshot({path: `${outputDir}/${fileName}_${i + 1}.png`});
        savedScreenshots++;

        // Undo the highlights so the test continues on an unchanged page.
        for (const element of highlighted) {
            try {
                await element.evaluate((el) => {
                    const saved = el.getAttribute("data-axe-old-style");
                    if (saved) {
                        const [position, outline] = JSON.parse(saved);
                        el.style.position = position;
                        el.style.outline = outline;
                        el.removeAttribute("data-axe-old-style");
                    }
                    el.querySelectorAll(":scope > [data-axe-marker]").forEach(marker => marker.remove());
                }, undefined, {timeout: 250});
            } catch (ignore: any) {
            }
        }
    }
    return savedScreenshots;
}

// Read once per process. Same source and precedence as buildReport.js:
// dotenv loads .env.a11y, and variables already set in the shell win.
let cachedConfig: any = null;

function loadEnvConfig() {
    if (cachedConfig !== null) return cachedConfig;
    dotenv.config({path: path.join(process.cwd(), ".env.a11y")});
    const env = process.env;
    const isOn = (name: string, fallback: boolean) => {
        const value = env[name];
        return value ? value.toUpperCase() === "ON" : fallback;
    };
    const list = (name: string) => (env[name] || "").split(",").map(t => t.trim()).filter(Boolean);
    const screenshotMode = normalizeScreenshotMode(env.SCREENSHOT_MODE || "all");

    cachedConfig = {
        scan: isOn("SCAN", true),
        outputDir: (env.OUTPUT_DIR || "axe-playwright-report") + "/pages",
        screenshots: isOn("SCREENSHOT", false) && screenshotMode !== "off",
        screenshotMode,
        maxScreenshotsPerPage: parseScreenshotLimit(env.MAX_SCREENSHOTS_PER_PAGE, Number.POSITIVE_INFINITY),
        resultMode: normalizeResultMode(env.RESULT_MODE || "full"),
        // Passes are stored by default; only the literal value "OFF" drops them
        // (they are the largest, rarely-read slice of an axe result).
        includePasses: (env.INCLUDE_PASSES || "").toUpperCase() !== "OFF",
        tags: list("TAGS"),
        withRules: list("WITH_RULES"),
        excludeRules: list("EXCLUDE_RULES"),
        include: list("INCLUDE"),
        exclude: list("EXCLUDE"),
        customRegExp: parseCustomRegExp(env.CUSTOM_REG_EXP),
    };
    return cachedConfig;
}

/**
 * Parses `CUSTOM_REG_EXP`, a list like `["^\/a\d+$", "\/b"]`. An empty value
 * (or `[]`) means no custom patterns: an empty RegExp would match everywhere.
 */
export function parseCustomRegExp(raw: string | undefined): RegExp[] {
    if (!raw) return [];
    return raw.slice(1, -1).split('", "')
        .map(s => s.replace(/^"|"$/g, ''))
        .filter(Boolean)
        .map(pattern => {
            try {
                return new RegExp(pattern, "g");
            } catch (e) {
                throw new Error(`Invalid regex pattern: ${pattern} — ${e}`);
            }
        });
}

function normalizeScreenshotMode(value: string): "off" | "violations" | "all" {
    const normalized = value.toLowerCase();
    if (normalized === "off" || normalized === "violations" || normalized === "all") return normalized;
    return "all";
}

function normalizeResultMode(value: string): "full" | "compact" {
    return value.toLowerCase() === "compact" ? "compact" : "full";
}

function parseScreenshotLimit(value: string | undefined, fallback: number) {
    if (value === undefined || value === "") return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function highlightElement(element: Locator, index: number, color: string) {
    try {
        await element.evaluate((el, args) => {
            el.scrollIntoView({behavior: "auto", block: "center"});
            // Save the inline styles we override; cleanup restores them.
            if (!el.hasAttribute("data-axe-old-style")) {
                el.setAttribute("data-axe-old-style", JSON.stringify([el.style.position, el.style.outline]));
            }
            // Only static elements need `relative` to anchor the marker; fixed/absolute ones keep their layout.
            if (getComputedStyle(el).position === "static") el.style.position = "relative";
            el.style.outline = `2px solid ${args.color}`; // Highlight border with given color

            // Create a marker div
            const marker = document.createElement("div");
            marker.setAttribute("data-axe-marker", "");
            marker.textContent = `${args.index + 1}`; // Numbering

            // Style the marker
            marker.style.position = "absolute";
            marker.style.top = "50%"; // Start at middle
            marker.style.left = "50%"; // Start at middle
            marker.style.transform = "translate(-50%, -50%)"; // Center correctly
            marker.style.width = "22px"; // Make a square
            marker.style.height = "22px";
            marker.style.display = "flex";
            marker.style.alignItems = "center";
            marker.style.justifyContent = "center";
            marker.style.background = args.color; // Use the passed color
            marker.style.color = "white";
            marker.style.fontSize = "14px";
            marker.style.fontWeight = "bold";
            marker.style.borderRadius = "50%"; // Make it circular

            el.appendChild(marker);
        }, {index, color}, {timeout: 250});
    } catch (ignore: any) {
    }
}

export function normalizeUrl(url, customPatterns: RegExp[] = []) {
    const urlObj = new URL(url, "http://dummy.base");
    let pathname = urlObj.pathname;
    let isCustomRegExp = false;

    let counter = 1; // Unique counter across all matches
    for (const pattern of customPatterns) {
        const matches = [...pathname.matchAll(pattern)];

        if (matches.length > 0) {
            for (const match of matches) {
                pathname = pathname.replace(match[0], `/{$regExp${counter++}}`);
            }
            isCustomRegExp = true;
        }
        if (!pathname.includes("/", 0))  pathname += "/";
    }
    if (isCustomRegExp) {
        return pathname + urlObj.search;
    } else {

        const normalizedPath = urlObj.pathname
            .split("/")
            .filter(Boolean)
            .map(segment => {
                if (segment.includes(".")) return segment; // e.g., inventory.html
                if (/^\d+$/.test(segment)) return ":id"; // numbers only
                if (/^(?=.*[a-zA-Z])(?=.*[0-9])[a-zA-Z0-9]{5,36}$/.test(segment)) return ":value";
                if (/^(?=.*[a-zA-Z])(?=.*[0-9])[a-zA-Z0-9-]{4,11}$/.test(segment)) return ":slug_id";
                if (/^(?=.*[a-zA-Z])(?=.*[0-9])[a-zA-Z0-9-]{12,36}$/.test(segment)) return ":uuid";
                return segment;
            })
            .join("/");

        const params = Array.from(urlObj.searchParams.entries())
            .map(([key]) => `${key}=*`)
            .sort();

        const normalizedSearch = params.length > 0 ? `?${params.join("&")}` : "";

        return "/" + normalizedPath + normalizedSearch;
    }
}
