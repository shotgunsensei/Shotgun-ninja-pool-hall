import type { JSX } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Bot, Users, Wifi, Settings as SettingsIcon } from "lucide-react";

interface MenuItem {
  to: string;
  title: string;
  desc: string;
  icon: JSX.Element;
  testId: string;
  tag: string;
}

const ITEMS: MenuItem[] = [
  {
    to: "/practice",
    title: "Practice",
    desc: "Free shoot, or drill against a basic CPU",
    icon: <Bot className="h-7 w-7" aria-hidden="true" />,
    testId: "menu-practice",
    tag: "SOLO",
  },
  {
    to: "/local",
    title: "Local 2 player",
    desc: "Pass the phone, hot-seat",
    icon: <Users className="h-7 w-7" aria-hidden="true" />,
    testId: "menu-local",
    tag: "HOT-SEAT",
  },
  {
    to: "/host",
    title: "Host online room",
    desc: "Spin up a code and share with a friend",
    icon: <Wifi className="h-7 w-7" aria-hidden="true" />,
    testId: "menu-host",
    tag: "HOST",
  },
  {
    to: "/join",
    title: "Join online room",
    desc: "Type a 4-letter code",
    icon: <Wifi className="h-7 w-7 rotate-180" aria-hidden="true" />,
    testId: "menu-join",
    tag: "JOIN",
  },
  {
    to: "/settings",
    title: "Settings",
    desc: "Aim guide, table speed, sound, vibration",
    icon: <SettingsIcon className="h-7 w-7" aria-hidden="true" />,
    testId: "menu-settings",
    tag: "CONFIG",
  },
];

function NinjaPoolLogo(): JSX.Element {
  return (
    <svg
      viewBox="0 0 64 64"
      className="w-16 h-16"
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14" fill="#0a0a0a" />
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        rx="13.5"
        fill="none"
        stroke="#dc2626"
        strokeOpacity="0.5"
      />
      <circle cx="32" cy="34" r="20" fill="#141416" />
      <circle
        cx="32"
        cy="34"
        r="20"
        fill="none"
        stroke="#dc2626"
        strokeWidth="1.4"
      />
      {/* Red ninja headband */}
      <path d="M12 28 H52 V35 H12 Z" fill="#dc2626" />
      <path d="M12 28 H52 V30 H12 Z" fill="#7f1d1d" opacity="0.7" />
      {/* Headband tail */}
      <path d="M48 35 L58 40 L52 38 Z" fill="#dc2626" />
      {/* 8-ball center disc */}
      <circle cx="32" cy="32" r="8" fill="#fafafa" />
      <text
        x="32"
        y="35.5"
        textAnchor="middle"
        fontFamily="Inter, ui-sans-serif, sans-serif"
        fontWeight="900"
        fontSize="10"
        fill="#0a0a0a"
      >
        8
      </text>
      {/* Ninja eyes peeking */}
      <circle cx="22" cy="31.5" r="1.4" fill="#0a0a0a" />
      <circle cx="42" cy="31.5" r="1.4" fill="#0a0a0a" />
    </svg>
  );
}

export default function MainMenu(): JSX.Element {
  return (
    <div className="min-h-screen w-full flex flex-col">
      <header className="px-5 pt-10 pb-6 text-center">
        <div className="mx-auto mb-4 flex justify-center">
          <NinjaPoolLogo />
        </div>
        <div className="mx-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border border-primary/40 bg-primary/10 text-primary font-mono text-[10px] tracking-[0.25em] uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          SYS::READY
        </div>
        <h1 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight uppercase leading-[1.05]">
          Shotgun Ninjas
          <br />
          <span className="text-primary">Pool Hall</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-[18rem] mx-auto">
          Run the table. Own the break. Tactical 8-ball — no ads, no login, no coins.
        </p>
      </header>

      <main className="flex-1 px-4 pb-6 max-w-md w-full mx-auto flex flex-col gap-3">
        {ITEMS.map((item) => (
          <Link key={item.to} href={item.to}>
            <Card
              className="cursor-pointer hover-elevate active-elevate-2 border-card-border/80"
              data-testid={item.testId}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="text-primary shrink-0 w-12 h-12 rounded-md border border-primary/30 bg-primary/5 flex items-center justify-center">
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold uppercase tracking-wide text-sm">
                      {item.title}
                    </div>
                    <span className="ml-auto font-mono text-[9px] tracking-[0.2em] text-muted-foreground/80 border border-border/60 rounded px-1.5 py-0.5">
                      {item.tag}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {item.desc}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </main>

      <footer className="px-4 pb-6 text-center text-[10px] text-muted-foreground/80 font-mono tracking-[0.18em] uppercase">
        SHOTGUN NINJAS // POOL HALL · v1.0
      </footer>
    </div>
  );
}
