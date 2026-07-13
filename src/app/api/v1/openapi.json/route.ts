import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/api/openapi";

/** GET /api/v1/openapi.json：OpenAPI 規格（M4-06，F-API-01 驗收 2）。規格本身不含秘密，公開可讀。 */
export function GET() {
  return NextResponse.json(openApiSpec);
}
