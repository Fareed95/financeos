import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { drainDueWebhooks } from "@/lib/server/ops";

export const Route = createFileRoute("/api/cron/webhooks")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        const header = request.headers.get("authorization") || "";
        if (!secret || header !== `Bearer ${secret}`) {
          return new Response(JSON.stringify({ error: "Background webhook delivery requires worker/cron configuration." }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        const sql = await getSql();
        const result = await drainDueWebhooks(sql);
        return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
