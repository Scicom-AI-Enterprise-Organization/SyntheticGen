"use client";

import { LayoutDashboard, Users, ShieldCheck, Building2, UserCog, Sparkles } from "lucide-react";
import { PageSidebar } from "@/components/page-sidebar";

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const sections = [
    {
      items: [
        { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { label: "AI Workspace", href: "/ai", icon: Sparkles },
        { label: "Profile", href: "/profile", icon: UserCog },
      ],
    },
    ...(isAdmin
      ? [
          {
            title: "Admin",
            items: [
              { label: "Users", href: "/admin/users", icon: Users },
              { label: "Roles", href: "/admin/roles", icon: ShieldCheck },
              { label: "Organization", href: "/admin/organization", icon: Building2 },
            ],
          },
        ]
      : []),
  ];

  return <PageSidebar sections={sections} />;
}
