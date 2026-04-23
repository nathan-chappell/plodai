import { loadEnv } from "vite";

const env = loadEnv("production", process.cwd(), "");

const requiredKeys = ["VITE_CLERK_PUBLISHABLE_KEY"];
const missingKeys = requiredKeys.filter((key) => {
  const value = env[key];
  return typeof value !== "string" || value.trim() === "";
});

if (missingKeys.length > 0) {
  console.error("Missing required frontend environment variables:");
  for (const key of missingKeys) {
    console.error(`- ${key}`);
  }
  console.error("");
  console.error("Set them in the shell or repository-root .env before running `npm run build`.");
  process.exit(1);
}

console.log("Frontend environment check passed.");
