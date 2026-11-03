//
// Every kind of background job this app runs. The runner looks a claimed
// job's kind up here; a kind that isn't listed fails for good. To add one:
// defineJob() in a file of its own, list it here, and enqueueJob() it from a service.
//

import type { JobDefinition } from "./define";
import { emailJob } from "./email";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a heterogeneous list; each definition checks its own payload
export const JOB_DEFINITIONS: readonly JobDefinition<any>[] = [emailJob];
