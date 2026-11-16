import "dotenv/config";
import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { MongoClient, ServerApiVersion } from "mongodb";

const requiredEnvironment = ["MONGODB_URI", "CONFIG_KEY_SECRET"];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}
if (process.env.CONFIG_KEY_SECRET.length < 32) throw new Error("CONFIG_KEY_SECRET must contain at least 32 characters.");

const port = Number(process.env.PORT || 8787);
const databaseName = process.env.MONGODB_DATABASE || "he30_driver";
const allowedOrigins = new Set(String(process.env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean));
const mongo = new MongoClient(process.env.MONGODB_URI, {
  maxPoolSize: 10,
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});
const collectionPromise = mongo.connect().then(async (client) => {
  const collection = client.db(databaseName).collection("device_configs");
  await collection.createIndex({ updatedAt: -1 });
  return collection;
});

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ""))) return callback(null, true);
    return callback(new Error("Origin is not allowed."));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"],
}));
app.use(express.json({ limit: "2mb", strict: true }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));

function normalizedSerial(value) {
  const serial = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9._:-]{4,128}$/.test(serial)) throw new Error("The keyboard serial number is missing or invalid.");
  return serial;
}

function deviceKey(serialNumber) {
  return crypto.createHmac("sha256", process.env.CONFIG_KEY_SECRET).update(normalizedSerial(serialNumber)).digest("hex");
}

function checkedPassphrase(value) {
  const passphrase = String(value || "");
  if (passphrase.length < 10 || passphrase.length > 128) throw new Error("The backup passphrase must contain 10–128 characters.");
  return passphrase;
}

function hashPassphrase(passphrase, salt = crypto.randomBytes(16)) {
  return new Promise((resolve, reject) => crypto.scrypt(passphrase, salt, 32, { N: 16384, r: 8, p: 1 }, (error, derived) => {
    if (error) reject(error);
    else resolve({ salt: salt.toString("base64"), hash: derived.toString("base64") });
  }));
}

async function passphraseMatches(passphrase, stored) {
  const candidate = await hashPassphrase(passphrase, Buffer.from(stored.passphraseSalt, "base64"));
  const left = Buffer.from(candidate.hash, "base64"), right = Buffer.from(stored.passphraseHash, "base64");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validateProfile(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Config must be a JSON object.");
  if (!Number.isInteger(Number(config.profileIndex)) || Number(config.profileIndex) < 0 || Number(config.profileIndex) > 2) throw new Error("Config has an invalid profile index.");
  for (let layer = 0; layer < 4; layer += 1) {
    const mappings = config.userKeys?.[layer] || config.userKeys?.[String(layer)];
    if (!Array.isArray(mappings) || mappings.length < 128) throw new Error(`Config layer ${layer} must contain 128 mappings.`);
  }
  if (!Array.isArray(config.travelKeys) || config.travelKeys.length < 128) throw new Error("Config must contain 128 Hall records.");
  if (!Array.isArray(config.advancedKeys)) throw new Error("Config is missing its Advanced-action list.");
  if (!Array.isArray(config.colorKeys) || config.colorKeys.length < 128) throw new Error("Config must contain 128 per-key colors.");
  if (!config.light || !config.logoLight || !config.deviceSettings) throw new Error("Config is missing settings or lighting data.");
  const serialized = JSON.stringify(config);
  if (Buffer.byteLength(serialized, "utf8") > 1_500_000) throw new Error("Config is larger than the 1.5 MB storage limit.");
  return JSON.parse(serialized);
}

app.get("/health", async (_request, response, next) => {
  try {
    const collection = await collectionPromise;
    await collection.findOne({}, { projection: { _id: 1 } });
    response.json({ ok: true, service: "he30-config-cloud" });
  } catch (error) { next(error); }
});

app.post("/api/configs/upload", async (request, response, next) => {
  try {
    const _id = deviceKey(request.body?.serialNumber);
    const passphrase = checkedPassphrase(request.body?.passphrase);
    const config = validateProfile(request.body?.config);
    const collection = await collectionPromise;
    const now = new Date();
    let existing = await collection.findOne({ _id }, { projection: { passphraseSalt: 1, passphraseHash: 1 } });
    if (!existing) {
      const password = await hashPassphrase(passphrase);
      try {
        await collection.insertOne({
          _id,
          schemaVersion: 1,
          profileIndex: Number(config.profileIndex),
          config,
          passphraseSalt: password.salt,
          passphraseHash: password.hash,
          createdAt: now,
          updatedAt: now,
        });
        return response.json({ ok: true, profileIndex: Number(config.profileIndex), updatedAt: now.toISOString() });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        // A simultaneous first upload claimed this serial. Reload and verify its
        // passphrase instead of allowing the losing request to replace the claim.
        existing = await collection.findOne({ _id }, { projection: { passphraseSalt: 1, passphraseHash: 1 } });
      }
    }
    if (!existing || !(await passphraseMatches(passphrase, existing))) return response.status(403).json({ error: "The backup passphrase is incorrect." });
    await collection.updateOne({ _id }, { $set: {
      schemaVersion: 1,
      profileIndex: Number(config.profileIndex),
      config,
      updatedAt: now,
    } });
    response.json({ ok: true, profileIndex: Number(config.profileIndex), updatedAt: now.toISOString() });
  } catch (error) { next(error); }
});

app.post("/api/configs/download", async (request, response, next) => {
  try {
    const _id = deviceKey(request.body?.serialNumber);
    const passphrase = checkedPassphrase(request.body?.passphrase);
    const collection = await collectionPromise;
    const stored = await collection.findOne({ _id });
    if (!stored) return response.status(404).json({ error: "No cloud backup exists for this keyboard." });
    if (!(await passphraseMatches(passphrase, stored))) return response.status(403).json({ error: "The backup passphrase is incorrect." });
    response.set("Cache-Control", "no-store");
    response.json({ ok: true, config: stored.config, updatedAt: stored.updatedAt });
  } catch (error) { next(error); }
});

app.use((error, _request, response, _next) => {
  const clientError = (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, "body")) || /serial|passphrase|Config|Origin/.test(error.message);
  if (!clientError) console.error(error);
  response.status(clientError ? 400 : 500).json({ error: clientError ? error.message : "The cloud service could not complete the request." });
});

const server = app.listen(port, () => console.log(`HE30 cloud API listening on port ${port}`));
async function shutdown() {
  server.close();
  await mongo.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
