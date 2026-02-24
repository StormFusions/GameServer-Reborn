import protobuf from "protobufjs";

// Load TappedOut.proto once and cache the Root and lookup helpers
const root = await protobuf.load("TappedOut.proto");

// Pre-cache commonly used message types to avoid repeated lookups
const PRELOOKUP = [
  "Data.ClientConfigResponse",
  "Data.CurrencyData",
  "Data.UsersResponseMessage",
  "Data.WholeLandTokenResponse",
  "Data.DeleteTokenRequest",
  "Data.DeleteTokenResponse",
  "Data.LandMessage",
  "Data.LandMessage.FriendData",
  "Data.ExtraLandMessage",
  "Data.ExtraLandResponse",
  "Data.CurrencyDelta",
  "Data.ClientLogMessage",
  "Data.GameplayConfigResponse",
  "Data.GetFriendDataResponse",
  "Data.GetFriendDataResponse.FriendDataPair",
];

const types = Object.create(null);
for (const n of PRELOOKUP) {
  try {
    types[n] = root.lookupType(n);
  } catch (err) {
    // ignore missing types; fallback to lookup on demand
  }
}

function lookupType(name) {
  if (types[name]) return types[name];
  // lazily resolve if not pre-cached
  const t = root.lookupType(name);
  types[name] = t;
  return t;
}

export default { root, lookupType, types };
