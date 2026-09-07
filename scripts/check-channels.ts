import assert from "node:assert/strict";
import {
  CHANNELS,
  CHANNEL_LABEL,
  channelLabels,
  parseChannels,
  sameChannelSet,
  serializeChannels,
} from "../src/lib/fiscal";

const stored = "LOCAL,DELIVERY,ONLINE";
const parsed = parseChannels(stored);
assert.deepEqual(parsed, ["LOCAL", "DELIVERY"]);
assert.deepEqual(channelLabels(stored), ["Salón / terraza", "Delivery"]);
assert.equal(serializeChannels(parsed), "LOCAL,DELIVERY");
assert.ok(sameChannelSet(stored, "LOCAL,DELIVERY"));
assert.ok(!channelLabels(stored).includes("En línea"));
assert.deepEqual([...CHANNELS], ["LOCAL", "BARRA", "TAKEAWAY", "DELIVERY"]);
for (const key of CHANNELS) {
  assert.ok(CHANNEL_LABEL[key]);
}
console.log("channels ok", parsed.join(","), channelLabels(stored).join(" · "));
