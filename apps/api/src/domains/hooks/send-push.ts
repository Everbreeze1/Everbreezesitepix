import { jsonError, jsonOk } from "../../lib/errors";
import { verifyCronSecret } from "../../lib/cron-auth";
import { getSupabaseAdmin } from "../../lib/supabase";
import { chunk, mutateIn } from "../../lib/chunked-in";
import { recordJobRun } from "../../lib/job-run";
import {
  batches,
  devicesByUser,
  expoMessagesFor,
  isPushable,
  PUSH_MAX_AGE_HOURS,
  tokensToDrop,
  type ExpoTicket,
  type PushableNotification,
  type RegisteredDevice,
} from "../notifications/push";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Deliver push for notifications nothing has delivered yet.
 *
 * A sweep rather than a hook on insert, and that is not laziness. Most
 * notifications are raised by database triggers - `task_assigned`,
 * `checklist_assigned`, every `*_completed`, `task_comment`,
 * `project_assigned` - which are written in SQL and never pass through server
 * code. Sending from `insertNotification` would cover the four service-layer
 * types and silently skip the nine that matter most. The cost is the delay
 * between runs, which for "somebody assigned you a task" is acceptable and for
 * nothing else in this table is even relevant.
 *
 * Every row it considers is stamped, delivered or not. A recipient with no
 * registered device produces no message, and without the stamp every future
 * sweep would reconsider them forever.
 *
 * Runs on the same cron secret the other hooks use.
 */
export async function handleSendPush(request: Request): Promise<Response> {
  if (!(await verifyCronSecret(request))) {
    return jsonError(401, "unauthorized", "Unauthorized");
  }

  try {
    const outcome = await recordJobRun("send-push", async () => {
      const admin = getSupabaseAdmin();
      const since = new Date(Date.now() - PUSH_MAX_AGE_HOURS * 3600_000).toISOString();

      const { data: pending, error: readError } = await admin
        .from("notifications" as never)
        .select(
          "id, recipient_id, type, title, body, link_path, project_id, entity_type, entity_id",
        )
        .is("push_sent_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        // Bounded so one sweep after an outage cannot try to send ten thousand
        // messages in a single invocation and time out having sent none.
        .limit(500);
      if (readError) throw new Error(readError.message);

      const rows = (pending ?? []) as PushableNotification[];
      if (rows.length === 0) {
        return { result: { sent: 0, considered: 0, tokensDropped: 0 }, rowsAffected: 0 };
      }

      /*
       * Only fetch devices for people who have something pushable waiting.
       * Reading the whole token table would grow linearly with the customer
       * base to answer a question about a handful of rows.
       */
      const recipients = Array.from(
        new Set(rows.filter((row) => isPushable(row.type)).map((row) => row.recipient_id)),
      );

      const devices: RegisteredDevice[] = [];
      // Chunked at the same ceiling every other `.in()` here uses: PostgREST
      // echoes the ids in a Content-Location header, which overflows Node's
      // 16KB header limit somewhere around 400.
      for (const ids of chunk(recipients, 200)) {
        if (ids.length === 0) continue;
        const { data, error } = await admin
          .from("device_push_tokens" as never)
          .select("token, user_id")
          .in("user_id", ids);
        if (error) throw new Error(error.message);
        devices.push(...((data ?? []) as RegisteredDevice[]));
      }

      const messages = expoMessagesFor(rows, devicesByUser(devices));

      let sent = 0;
      const dead: string[] = [];
      for (const group of batches(messages)) {
        const response = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            // Expo compresses large batches; saying so avoids a needless
            // round trip on the ones that are.
            "accept-encoding": "gzip, deflate",
          },
          body: JSON.stringify(group),
        });

        if (!response.ok) {
          /*
           * A failed batch is left unstamped so the next sweep retries it, and
           * the loop carries on rather than throwing: one rejected batch must
           * not stop the others being delivered.
           */
          console.error("[send-push] batch rejected", response.status, await response.text());
          continue;
        }

        const payload = (await response.json()) as { data?: ExpoTicket[] };
        const tickets = payload?.data ?? [];
        sent += tickets.filter((ticket) => ticket?.status === "ok").length;
        dead.push(...tokensToDrop(group, tickets));
      }

      /*
       * Drop tokens Expo says are gone.
       *
       * `DeviceNotRegistered` means the app was uninstalled or the token was
       * reissued, and Expo rejects it forever after. Left in place it costs a
       * slot in every future batch.
       */
      let tokensDropped = 0;
      if (dead.length) {
        await mutateIn(
          dead,
          (ids) => {
            tokensDropped += ids.length;
            return admin
              .from("device_push_tokens" as never)
              .delete()
              .in("token", ids);
          },
          "drop dead push tokens",
        );
      }

      /*
       * Stamp everything considered, including rows that produced no message.
       *
       * The alternative - stamping only what was sent - means every sweep
       * forever reconsiders every notification belonging to somebody with no
       * registered device, which is most people on the day this ships.
       */
      const stampedAt = new Date().toISOString();
      await mutateIn(
        rows.map((row) => row.id),
        (ids) =>
          admin
            .from("notifications" as never)
            .update({ push_sent_at: stampedAt } as never)
            .in("id", ids),
        "stamp push_sent_at",
      );

      return {
        result: { sent, considered: rows.length, tokensDropped },
        rowsAffected: sent,
        meta: { messages: messages.length, devices: devices.length },
      };
    });

    return jsonOk(outcome);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Push sweep failed";
    return jsonError(500, "send_push_failed", message);
  }
}
