import dotenv from "dotenv";

dotenv.config({ quiet: true });

const baseURL = (process.env.BASE_URL ?? "http://127.0.0.1:8000").trim();

async function assertReachable(url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "manual" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to reach ${url}. Start uvicorn first. ${message}`);
  }

  if (!response.ok && response.status !== 302) {
    throw new Error(`Expected ${url} to be reachable, but received HTTP ${response.status}.`);
  }
}

export default async function globalSetup(): Promise<void> {
  await assertReachable(`${baseURL}/health`);
  await assertReachable(`${baseURL}/sign-in`);
}
