import React, { useState, useEffect } from 'react';
import * as React from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

export function Calendars({
  calendars,
}: {
  calendars: {
    name: string;
    items: {
      title: string;
      href: string;
      icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    }[];
  }[];
}) {
  const [currentPath, setCurrentPath] = React.useState("");

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentPath(window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <>
      {calendars.map((calendar, index) => (
        <React.Fragment key={calendar.name}>
          <SidebarGroup className="py-0">
            <Collapsible defaultOpen={index === 0} className="group/collapsible">
              <SidebarGroupLabel
                asChild
                className="group/label text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full text-sm"
              >
                <CollapsibleTrigger>
                  {calendar.name}{" "}
                  <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>

              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {calendar.items.map(({ title, href, icon: Icon }) => {
                      const isActive = currentPath === href;

                      return (
                        <SidebarMenuItem key={title}>
                          <Link
                            href={href}
                            className={`flex items-center gap-2 w-full px-4 py-2 rounded text-sm ${isActive
                                ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                                : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                              }`}
                          >
                            {Icon && <Icon className="w-4 h-4" />}
                            {title}
                          </Link>
                        </SidebarMenuItem>

                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
          <SidebarSeparator className="mx-0" />
        </React.Fragment>
      ))}
    </>
  );
}
