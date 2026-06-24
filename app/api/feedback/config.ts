import OpenAI from "openai";

const baseUrl: string = process.env.AI_BASE_URL ?? "";
const apiKey: string = process.env.AI_API_KEY ?? "";
const model: string = process.env.AI_MODEL ?? "";

if (baseUrl.trim().length === 0) {
  throw new Error(
    "Server misconfigured: AI_BASE_URL is missing. Set it in the environment before starting the server."
  );
}
if (!/^https?:\/\//.test(baseUrl)) {
  throw new Error(
    `Server misconfigured: AI_BASE_URL must start with http:// or https:// (got "${baseUrl}").`
  );
}
if (apiKey.trim().length === 0) {
  throw new Error(
    "Server misconfigured: AI_API_KEY is missing. Set it in the environment before starting the server."
  );
}
if (model.trim().length === 0) {
  throw new Error(
    "Server misconfigured: AI_MODEL is missing. Set it in the environment before starting the server."
  );
}

const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

export const client = new OpenAI({
  apiKey,
  baseURL: normalizedBaseUrl,
});

export { model, normalizedBaseUrl as baseUrl };
