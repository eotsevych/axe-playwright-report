import type {Reporter} from '@playwright/test/reporter';
import {main, cleanUp, test} from './buildReport';
import {FullConfig} from "@playwright/test";

class AxeReporter implements Reporter {

    softAssert: boolean | undefined;

    constructor(config?: { softAssert?: boolean }) {
        this.softAssert = config?.softAssert
    }

    onBegin() {
        cleanUp()
    }

    async onEnd() {
        if (this.softAssert === undefined) await main()
        else {
            await main()
            const isFailed = test(this.softAssert, true)
            if (isFailed) process.exit(1)
        }
    }
}

export default AxeReporter;