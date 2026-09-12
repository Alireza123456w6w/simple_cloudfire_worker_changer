import { NextResponse } from "next/server";
import { cf, friendlyCfError } from "@/lib/cf";

export const dynamic = "force-dynamic";

const CF = "https://api.cloudflare.com/client/v4";

interface WorkerRow {
  id?: string;
  modified_on?: string;
}
interface D1Row {
  uuid?: string;
  name?: string;
  created_at?: string;
}

/** لیست Workerها و دیتابیس‌های D1 یک اکانت */
export async function POST(req: Request) {
  let apiToken = "";
  let accountId = "";
  try {
    ({ apiToken = "", accountId = "" } = await req.json());
  } catch {
    /* بدنه خالی */
  }
  apiToken = (apiToken || "").trim();
  accountId = (accountId || "").trim();
  if (!apiToken || !accountId) {
    return NextResponse.json(
      { ok: false, error: "API Token و Account ID هر دو لازم است" },
      { status: 400 }
    );
  }
  const auth = { Authorization: `Bearer ${apiToken}` };
  const warnings: string[] = [];

  // Workers + D1 به‌صورت موازی (سرعت بیشتر)
  const [wRes, dRes] = await Promise.allSettled([
    cf(`${CF}/accounts/${accountId}/workers/scripts?per_page=100`, { headers: auth }, 20000),
    cf(`${CF}/accounts/${accountId}/d1/database?per_page=100`, { headers: auth }, 20000),
  ]);

  // Workers
  let workers: { name: string; modifiedOn: string | null }[] = [];
  if (wRes.status === "fulfilled" && wRes.value.ok && Array.isArray(wRes.value.data.result)) {
    workers = (wRes.value.data.result as WorkerRow[])
      .map((x) => ({ name: x.id ?? "", modifiedOn: x.modified_on ?? null }))
      .filter((x) => x.name);
  } else {
    warnings.push(
      "لیست Workerها گرفته نشد: " +
        (wRes.status === "fulfilled"
          ? friendlyCfError(wRes.value.data.errors, wRes.value.status)
          : "اتصال برقرار نشد")
    );
  }

  // D1
  let databases: { name: string; uuid: string; createdAt: string | null }[] = [];
  if (dRes.status === "fulfilled" && dRes.value.ok) {
    const raw = (Array.isArray(dRes.value.data.result)
      ? dRes.value.data.result
      : (dRes.value.data.result as { results?: D1Row[] } | null)?.results ?? []) as D1Row[];
    databases = raw
      .filter((x) => x.uuid && x.name)
      .map((x) => ({ name: x.name as string, uuid: x.uuid as string, createdAt: x.created_at ?? null }));
  } else {
    warnings.push(
      "لیست دیتابیس‌های D1 گرفته نشد: " +
        (dRes.status === "fulfilled"
          ? friendlyCfError(dRes.value.data.errors, dRes.value.status)
          : "اتصال برقرار نشد")
    );
  }

  if (warnings.length === 2) {
    return NextResponse.json({ ok: false, error: warnings[0] }, { status: 200 });
  }

  return NextResponse.json({ ok: true, workers, databases, warnings });
}
