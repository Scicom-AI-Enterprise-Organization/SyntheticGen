import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/rbac";

export default async function HomePage() {
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}
