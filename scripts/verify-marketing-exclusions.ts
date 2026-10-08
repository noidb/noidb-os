import assert from "node:assert/strict";
import { expandMarketingExclusions } from "../lib/wms/marketing-permanent-exclusions";
const items = [{ skuId: "1", modelName: "we0001" }, { skuId: "2", modelName: "we0001" }, { skuId: "3", modelName: "wn11" }, { skuId: "4", modelName: "" }];
const r = expandMarketingExclusions(items, ["1", "4", "999"]);
assert.deepEqual([...r.skuIds].sort(), ["1", "2", "4", "999"]); assert.deepEqual(r.models, ["we0001"]);
console.log("PASS marketing permanent exclusions expand to the whole model");
