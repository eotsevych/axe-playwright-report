import type {Reporter} from '@playwright/test/reporter';
import {main, cleanUp, test} from './buildReport';

class AxeReporter implements Reporter {

    softAssert: boolean | undefined;

    constructor(config?: { softAssert?: boolean }) {
        this.softAssert = config?.softAssert
    }

    onBegin() {
        cleanUp()
    }

    async onEnd() {
        const {reports, stats} = await main()
        // Return a status instead of exiting, so reporters listed after this one still finish.
        if (this.softAssert !== undefined && test(this.softAssert, reports, stats)) return {status: 'failed' as const}
    }
}

export default AxeReporter;
