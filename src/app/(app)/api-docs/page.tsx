import { requireUser } from "@/lib/rbac";
import { ApiDocs } from "./api-docs";

export default async function ApiDocsPage() {
  await requireUser();
  return <ApiDocs />;
}
