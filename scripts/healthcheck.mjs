const port = process.env.PORT ?? "3000";
const baseUrl = (process.env.HEALTHCHECK_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");

try {
  const response = await fetch(`${baseUrl}/api/health`);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[healthcheck] ${response.status} ${body}`.trim());
    process.exit(1);
  }

  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[healthcheck] ${message}`);
  process.exit(1);
}
