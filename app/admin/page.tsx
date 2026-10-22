import { notFound } from "next/navigation";
import OwnerConsole from "@/components/admin/OwnerConsole";

export const metadata = { title: "Owner · Beebly", robots: { index: false, follow: false } };

// The owner page only exists under `npm run dev`. Production builds (Vercel) return 404.
// The database still checks the owners table on every owner call.
export default function AdminPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <OwnerConsole />;
}
