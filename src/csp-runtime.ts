import { z } from "zod";

// Set before schemas initialize: strict script-src disallows dynamic code.
// Zod's interpreted validators provide the same checks without an eval probe.
z.config({ jitless: true });
